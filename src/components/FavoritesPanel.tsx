import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import type { Favorite, FavoriteType } from "../types";

interface Props {
  serverId: string;
  onRunCommand: (value: string, run: boolean) => void;
  onGoPath: (path: string) => void;
}

export function FavoritesPanel({ serverId, onRunCommand, onGoPath }: Props) {
  const [items, setItems] = useState<Favorite[]>([]);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [type, setType] = useState<FavoriteType>("command");
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      setItems(
        (await api.listFavorites(serverId)).filter(
          (f) => f.type === "command" || f.type === "path",
        ),
      );
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    void reload();
  }, [serverId]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.upsertFavorite({
        serverId,
        type,
        label: label.trim() || value.trim(),
        value: value.trim(),
        sortOrder: items.length,
      });
      setLabel("");
      setValue("");
      await reload();
    } catch (err) {
      setError(String(err));
    }
  };

  const remove = async (id: string) => {
    await api.deleteFavorite(id);
    await reload();
  };

  return (
    <div className="panel-content">
      <form className="panel-toolbar" onSubmit={add}>
        <select value={type} onChange={(e) => setType(e.target.value as FavoriteType)}>
          <option value="command">명령</option>
          <option value="path">경로</option>
        </select>
        <input
          placeholder="라벨"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={{ width: 100 }}
        />
        <input
          placeholder={type === "command" ? "예: htop" : "예: /var/log"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          style={{ flex: 1, minWidth: 120 }}
        />
        <button className="btn primary" type="submit">
          추가
        </button>
      </form>
      {error && <div className="msg error" style={{ padding: "0 8px" }}>{error}</div>}
      <div className="list">
        {items.length === 0 && (
          <div className="empty-state" style={{ height: "auto", paddingTop: 40 }}>
            <p>자주 쓰는 명령이나 경로를 추가하세요.</p>
          </div>
        )}
        {items.map((item) => (
          <div key={item.id} className="list-row" style={{ cursor: "default" }}>
            <span className="badge">{item.type === "command" ? "CMD" : "PATH"}</span>
            <div className="grow">
              <div>{item.label}</div>
              <div className="sub">{item.value}</div>
            </div>
            {item.type === "command" ? (
              <>
                <button className="btn" type="button" onClick={() => onRunCommand(item.value, false)}>
                  삽입
                </button>
                <button className="btn" type="button" onClick={() => onRunCommand(item.value, true)}>
                  실행
                </button>
              </>
            ) : (
              <button className="btn" type="button" onClick={() => onGoPath(item.value)}>
                이동
              </button>
            )}
            <button className="btn danger" type="button" onClick={() => void remove(item.id)}>
              삭제
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
