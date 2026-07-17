import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Favorite } from "../types";
import { LOCAL_FAVORITES_SERVER_ID } from "../types";
import { pathBookmarkLabel } from "./fileManagerShared";

interface Props {
  kind: "local" | "remote";
  serverId?: string;
  currentPath: string;
  onNavigate: (path: string) => void;
  onStatus: (msg: string | null, isError?: boolean) => void;
}

export function PathFavoritesBar({
  kind,
  serverId,
  currentPath,
  onNavigate,
  onStatus,
}: Props) {
  const [items, setItems] = useState<Favorite[]>([]);
  const [busy, setBusy] = useState(false);

  const storageServerId =
    kind === "local" ? LOCAL_FAVORITES_SERVER_ID : serverId ?? "";
  const favoriteType = kind === "local" ? "localPath" : "remotePath";

  const reload = useCallback(async () => {
    if (!storageServerId) return;
    try {
      const all = await api.listFavorites(storageServerId);
      setItems(all.filter((f) => f.type === favoriteType));
    } catch (e) {
      onStatus(String(e), true);
    }
  }, [storageServerId, favoriteType, onStatus]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const canBookmark =
    kind === "local" ? currentPath !== "" : Boolean(currentPath);

  const addCurrent = async () => {
    if (!canBookmark || !storageServerId) return;
    const exists = items.some((i) => i.value === currentPath);
    if (exists) {
      onStatus("이미 즐겨찾기에 있는 경로입니다");
      return;
    }
    setBusy(true);
    try {
      await api.upsertFavorite({
        serverId: storageServerId,
        type: favoriteType,
        label: pathBookmarkLabel(currentPath),
        value: currentPath,
        sortOrder: items.length,
      });
      await reload();
      onStatus(`즐겨찾기 추가: ${currentPath}`);
    } catch (e) {
      onStatus(String(e), true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await api.deleteFavorite(id);
      await reload();
    } catch (e) {
      onStatus(String(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fm-fav-bar">
      <button
        type="button"
        className="btn fm-fav-add"
        disabled={busy || !canBookmark}
        title="현재 경로를 즐겨찾기에 추가"
        onClick={() => void addCurrent()}
      >
        ★ 즐겨찾기
      </button>
      <div className="fm-fav-list">
        {items.length === 0 && (
          <span className="fm-fav-empty">경로 즐겨찾기 없음</span>
        )}
        {items.map((item) => (
          <span key={item.id} className="fm-fav-chip">
            <button
              type="button"
              className="fm-fav-go"
              title={item.value}
              onClick={() => onNavigate(item.value)}
            >
              {item.label}
            </button>
            <button
              type="button"
              className="fm-fav-del"
              title="즐겨찾기 삭제"
              disabled={busy}
              onClick={() => void remove(item.id)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
