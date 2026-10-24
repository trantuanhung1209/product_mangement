import { useEffect, useState } from "react";
import { ChevronRight, Monitor } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import * as authApi from "../api/auth";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { useToast } from "../components/feedback/Toast";
import type { AuthUser, LoginSession } from "../types/catalog";
import { formatDate } from "../utils/format";

type Data = {
  user: AuthUser;
  active_session_count: number;
  sessions: LoginSession[];
};

export function AdminUserSessionsPage() {
  const { userId = "" } = useParams();
  const { showToast } = useToast();
  const [data, setData] = useState<Data>();
  const [target, setTarget] = useState<LoginSession | "all" | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    void authApi
      .getAdminUserSessions(userId)
      .then((response) => setData(response.data))
      .catch(() => showToast("Không thể tải phiên người dùng.", "error"));
  useEffect(load, [userId]);
  const revoke = async () => {
    if (!target) return;
    setBusy(true);
    try {
      if (target === "all") {
        const response = await authApi.revokeAllAdminSessions(userId);
        showToast(`Đã thu hồi ${response.data.revoked_count} phiên.`);
      } else {
        await authApi.revokeAdminSession(userId, target.session_id);
        showToast("Đã thu hồi phiên.");
      }
      setTarget(null);
      load();
    } catch {
      showToast("Không thể thu hồi phiên.", "error");
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return (
      <section className="state-panel">
        <p>Đang tải phiên người dùng...</p>
      </section>
    );
  return (
    <>
      <header className="page-header">
        <div className="breadcrumb">
          <Link to="/admin/users">Người dùng</Link>
          <ChevronRight size={14} aria-hidden="true" />
          <strong>Phiên đăng nhập</strong>
        </div>
        <div className="page-heading-row">
          <div>
            <h1>{data.user.email}</h1>
            <p>{data.active_session_count} phiên đang hoạt động.</p>
          </div>
          <button
            className="danger-button"
            onClick={() => setTarget("all")}
            disabled={!data.sessions.length}
          >
            Thu hồi tất cả
          </button>
        </div>
      </header>
      <section className="session-list">
        {data.sessions.map((session) => (
          <article className="session-card" key={session.session_id}>
            <Monitor size={20} aria-hidden="true" />
            <div>
              <strong>Phiên đăng nhập</strong>
              <p>{session.user_agent}</p>
              <small>
                Đăng nhập: {formatDate(session.created_at)} · Hoạt động:{" "}
                {formatDate(session.last_active_at)} · Hết hạn:{" "}
                {formatDate(session.expires_at)}
              </small>
            </div>
            <button
              className="danger-button"
              onClick={() => setTarget(session)}
            >
              Thu hồi
            </button>
          </article>
        ))}
      </section>
      {target && (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Thu hồi phiên"
          title={
            target === "all" ? "Thu hồi tất cả phiên?" : "Thu hồi phiên này?"
          }
          description="Thao tác sẽ đăng xuất các browser được chọn và không thể hoàn tác."
          onCancel={() => setTarget(null)}
          onConfirm={() => void revoke()}
        />
      )}
    </>
  );
}
