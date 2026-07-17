use crate::models::InfisicalConfig;
use crate::store::load_client_secret;
use anyhow::{bail, Context, Result};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct SecretResponse {
    secret: SecretBody,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecretBody {
    secret_value: String,
}

pub struct InfisicalClient {
    http: reqwest::Client,
}

impl InfisicalClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
        }
    }

    fn base_url(config: &InfisicalConfig) -> String {
        let url = if config.site_url.trim().is_empty() {
            "https://app.infisical.com".to_string()
        } else {
            config.site_url.trim_end_matches('/').to_string()
        };
        url
    }

    async fn login(&self, config: &InfisicalConfig, client_secret: &str) -> Result<String> {
        if config.client_id.trim().is_empty() {
            bail!("Infisical clientId가 설정되지 않았습니다");
        }
        if client_secret.trim().is_empty() {
            bail!("Infisical clientSecret이 설정되지 않았습니다");
        }

        let url = format!(
            "{}/api/v1/auth/universal-auth/login",
            Self::base_url(config)
        );
        let body = serde_json::json!({
            "clientId": config.client_id,
            "clientSecret": client_secret,
        });

        let res = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .context("Infisical 로그인 요청 실패")?;

        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            bail!("Infisical 로그인 실패 ({status}): {text}");
        }

        let parsed: LoginResponse = res
            .json()
            .await
            .context("Infisical 로그인 응답 파싱 실패")?;
        Ok(parsed.access_token)
    }

    pub async fn test_connection(&self, config: &InfisicalConfig) -> Result<()> {
        let secret = load_client_secret()?;
        let _token = self.login(config, &secret).await?;
        Ok(())
    }

    pub async fn get_secret(
        &self,
        config: &InfisicalConfig,
        project_id: &str,
        environment: &str,
        secret_path: &str,
        secret_name: &str,
    ) -> Result<String> {
        let client_secret = load_client_secret()?;
        let token = self.login(config, &client_secret).await?;

        let project = if project_id.trim().is_empty() {
            config.project_id.as_str()
        } else {
            project_id
        };
        let env = if environment.trim().is_empty() {
            config.environment.as_str()
        } else {
            environment
        };
        let path = if secret_path.trim().is_empty() {
            "/"
        } else {
            secret_path
        };

        if project.trim().is_empty() {
            bail!("Infisical projectId가 없습니다");
        }
        if env.trim().is_empty() {
            bail!("Infisical environment가 없습니다");
        }
        if secret_name.trim().is_empty() {
            bail!("시크릿 이름이 없습니다");
        }

        let url = format!(
            "{}/api/v3/secrets/raw/{}",
            Self::base_url(config),
            urlencoding_encode(secret_name)
        );

        let res = self
            .http
            .get(&url)
            .bearer_auth(&token)
            .query(&[
                ("workspaceId", project),
                ("environment", env),
                ("secretPath", path),
                ("include_imports", "true"),
                ("expandSecretReferences", "true"),
            ])
            .send()
            .await
            .context("Infisical 시크릿 조회 실패")?;

        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            bail!("시크릿 조회 실패 ({status}): {text}");
        }

        let parsed: SecretResponse = res.json().await.context("시크릿 응답 파싱 실패")?;
        if parsed.secret.secret_value.is_empty() {
            bail!("시크릿 값이 비어 있습니다");
        }
        Ok(parsed.secret.secret_value)
    }
}

fn urlencoding_encode(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}
