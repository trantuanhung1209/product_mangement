import { useEffect, useState } from "react";
import { ChevronRight, Monitor } from "lucide-react";

import * as authApi from "../api/auth";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { useToast } from "../components/feedback/Toast";
import type { LoginSession } from "../types/catalog";
import { formatDate } from "../utils/format";

export function SessionsPage() {
  const { logout } = useAuth();
  const { showToast } = useToast();
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<LoginSession | "others" | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => {
    setLoading(true);
    void authApi
      .getSessions()
      .then((response) => setSessions(response.data))
      .catch(() => showToast("Không thể tải phiên đăng nhập.", "error"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  const revoke = async () => {
    if (!target) return;
    setBusy(true);
    try {
      if (target === "others") {
        const response = await authApi.revokeOtherSessions();
        showToast(`Đã đăng xuất ${response.data.revoked_count} thiết bị khác.`);
        load();
      } else {
        await authApi.revokeSession(target.session_id);
        if (target.is_current) await logout();
        else {
          showToast("Đã thu hồi phiên đăng nhập.");
          load();
        }
      }
      setTarget(null);
    } catch {
      showToast("Không thể thu hồi phiên. Vui lòng thử lại.", "error");
    } finally {
      setBusy(false);
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
