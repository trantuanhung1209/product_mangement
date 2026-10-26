import { useState } from "react";
import { ChevronRight, Monitor } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { useToast } from "../components/feedback/Toast";
import { useAdminUserSessions, useRevokeAdminSessions } from "../hooks/useAdminUsers";
import type { LoginSession } from "../types/catalog";
import { formatDate } from "../utils/format";

export function AdminUserSessionsPage() {
  const { userId = "" } = useParams();
  const { showToast } = useToast();
  const { data, error, retry } = useAdminUserSessions(userId);
  const revokeMutation = useRevokeAdminSessions(userId);
  const [target, setTarget] = useState<LoginSession | "all" | null>(null);
  const busy = revokeMutation.isPending;
  const revoke = async () => {
    if (!target) return;
    try {
      const result = await revokeMutation.mutateAsync(target === "all" ? null : target.session_id);
      showToast(result ? `Đã thu hồi ${result.revoked_count} phiên.` : "Đã thu hồi phiên.");
      setTarget(null);
    } catch {
      showToast("Không thể thu hồi phiên.", "error");
    }
  };
  if (error)
    return (
      <section className="state-panel">
        <h2>Không thể tải phiên người dùng</h2>
        <button type="button" className="primary-button" onClick={retry}>Thử lại</button>
      </section>
    );
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
