import { useState } from "react";
import { ChevronRight, Monitor } from "lucide-react";

import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { useToast } from "../components/feedback/Toast";
import { useMySessions, useRevokeOtherSessions, useRevokeSession } from "../hooks/useSessions";
import type { LoginSession } from "../types/catalog";
import { formatDate } from "../utils/format";

export function SessionsPage() {
  const { logout, user } = useAuth();
  const { showToast } = useToast();
  const { sessions, loading, error, retry } = useMySessions(user?.id);
  const revokeOne = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const [target, setTarget] = useState<LoginSession | "others" | null>(null);
  const busy = revokeOne.isPending || revokeOthers.isPending;
  const revoke = async () => {
    if (!target) return;
    try {
      if (target === "others") {
        const result = await revokeOthers.mutateAsync();
        showToast(`Đã đăng xuất ${result.revoked_count} thiết bị khác.`);
      } else {
        await revokeOne.mutateAsync(target.session_id);
        if (target.is_current) await logout();
        else showToast("Đã thu hồi phiên đăng nhập.");
      }
      setTarget(null);
    } catch {
      showToast("Không thể thu hồi phiên. Vui lòng thử lại.", "error");
    }
  };
  return (
    <>
      <header className="page-header">
        <div className="breadcrumb">
          <span>Tài khoản</span>
          <ChevronRight size={14} aria-hidden="true" />
          <strong>Phiên đăng nhập</strong>
        </div>
        <div className="page-heading-row">
          <div>
            <h1>Phiên đăng nhập của tôi</h1>
            <p>Quản lý các browser đang truy cập tài khoản này.</p>
          </div>
          <button
            className="secondary-button"
            onClick={() => setTarget("others")}
            disabled={!sessions.some((item) => !item.is_current)}
          >
            Đăng xuất thiết bị khác
          </button>
        </div>
      </header>
      {loading ? (
        <section className="state-panel">
          <p>Đang tải phiên đăng nhập...</p>
        </section>
      ) : error ? (
        <section className="state-panel">
          <h2>Không thể tải phiên đăng nhập</h2>
          <button type="button" className="primary-button" onClick={retry}>Thử lại</button>
        </section>
      ) : (
        <section className="session-list">
          {sessions.map((session) => (
            <article className="session-card" key={session.session_id}>
              <Monitor size={20} aria-hidden="true" />
              <div>
                <strong>
                  {session.is_current ? "Phiên hiện tại" : "Phiên đăng nhập"}
                </strong>
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
                {session.is_current ? "Đăng xuất" : "Thu hồi"}
              </button>
            </article>
          ))}
        </section>
      )}
      {target && (
        <ConfirmDialog
          busy={busy}
          confirmLabel={
            target === "others" ? "Đăng xuất các thiết bị" : "Thu hồi phiên"
          }
          title="Thu hồi phiên đăng nhập?"
          description="Thiết bị được chọn sẽ không thể tiếp tục sử dụng phiên này."
          onCancel={() => setTarget(null)}
          onConfirm={() => void revoke()}
        />
      )}
    </>
  );
}
