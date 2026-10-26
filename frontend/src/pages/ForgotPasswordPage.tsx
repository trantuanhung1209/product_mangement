import { useState } from "react";
import { ArrowRight, KeyRound } from "lucide-react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { getApiFieldErrors } from "../api/errors";
import { useAuth } from "../auth/AuthContext";
import { PasswordInput } from "../components/feedback/PasswordInput";
import { PasswordRulesList } from "../components/feedback/PasswordRulesList";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useOtpClocks } from "../hooks/useOtpClocks";
import { useForgotPassword, useResetPassword } from "../hooks/usePasswordMutations";
import { describeError, formatClock, waitSeconds } from "../utils/authErrors";
import { passwordProblems } from "../utils/passwordRules";

export function ForgotPasswordPage() {
  useDocumentTitle("Quên mật khẩu");
  const { user } = useAuth();
  const navigate = useNavigate();
  const forgot = useForgotPassword();
  const resetPassword = useResetPassword();
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const clocks = useOtpClocks(step === "reset");

  if (user) return <Navigate to="/shop" replace />;

  const requestCode = (onSent?: () => void) => {
    setFormError("");
    forgot.mutate(email.trim(), {
      onSuccess: (timings) => {
        clocks.start(timings);
        onSent?.();
      },
      onError: (error) => {
        const wait = waitSeconds(error);
        if (wait !== null && step === "reset") clocks.holdResendFor(wait);
        setFormError(getApiFieldErrors(error).email ?? describeError(error));
      },
    });
  };

  const submitEmail = (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setFieldErrors({ email: "Email không hợp lệ." });
      return;
    }
    setFieldErrors({});
    requestCode(() => { setOtp(""); setStep("reset"); });
  };

  const submitReset = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    const errors: Record<string, string> = {};
    const problems = passwordProblems(password);
    if (problems.length) errors.password = problems[0];
    if (confirmation !== password) errors.confirmation = "Mật khẩu xác nhận không khớp.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    resetPassword.mutate(
      { email: email.trim(), otp, newPassword: password },
      {
        onSuccess: () =>
          navigate("/login", { replace: true, state: { notice: "Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới." } }),
        onError: (error) => {
          const apiErrors = getApiFieldErrors(error);
          if (apiErrors.new_password) setFieldErrors({ password: apiErrors.new_password });
          else setFormError(apiErrors.otp ?? describeError(error));
        },
      },
    );
  };

  return (
    <main className="login-page">
      <section className="login-intro">
        <span className="brand-mark"><KeyRound size={20} aria-hidden="true" /></span>
        <p className="eyebrow">PRODUCT CATALOG</p>
        <h1>Lấy lại quyền<br />truy cập tài khoản.</h1>
        <p>Xác minh email bằng mã 6 chữ số rồi đặt mật khẩu mới.</p>
      </section>
      {step === "email" ? (
        <form className="login-card" onSubmit={submitEmail} noValidate>
          <p className="eyebrow">QUÊN MẬT KHẨU</p>
          <h2>Đặt lại mật khẩu</h2>
          <p>Nhập email tài khoản, chúng tôi sẽ gửi mã xác minh nếu tài khoản tồn tại.</p>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <div className="password-field-group">
            <label htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? "forgot-email-error" : undefined}
              autoFocus
            />
            {fieldErrors.email && <small className="field-error" id="forgot-email-error">{fieldErrors.email}</small>}
          </div>
          <button className="primary-button login-submit" disabled={forgot.isPending}>
            {forgot.isPending ? "Đang gửi mã..." : <>Gửi mã xác minh <ArrowRight size={16} aria-hidden="true" /></>}
          </button>
          <p className="auth-switch"><Link to="/login">Quay lại đăng nhập</Link></p>
        </form>
      ) : (
        <form className="login-card" onSubmit={submitReset} noValidate>
          <p className="eyebrow">XÁC MINH VÀ ĐẶT MẬT KHẨU MỚI</p>
          <h2>Nhập mã và mật khẩu mới</h2>
          <p>Nếu email hợp lệ, mã 6 chữ số đã được gửi tới <strong>{email.trim()}</strong>.</p>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <div className="password-field-group">
            <label htmlFor="reset-otp">Mã xác minh</label>
            <input
              id="reset-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
              autoFocus
            />
          </div>
          <p className="otp-timer" role="timer" aria-live="off">
            {clocks.expired ? "Mã đã hết hạn. Hãy gửi lại mã mới." : `Mã còn hiệu lực: ${formatClock(clocks.remaining)}`}
          </p>
          <PasswordInput
            label="Mật khẩu mới"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            error={fieldErrors.password}
            describedBy="reset-password-rules"
          />
          <PasswordRulesList password={password} id="reset-password-rules" />
          <PasswordInput
            label="Xác nhận mật khẩu mới"
            value={confirmation}
            onChange={setConfirmation}
            autoComplete="new-password"
            error={fieldErrors.confirmation}
          />
          <button className="primary-button login-submit" disabled={resetPassword.isPending || otp.length !== 6 || clocks.expired}>
            {resetPassword.isPending ? "Đang đặt lại..." : "Đặt lại mật khẩu"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => requestCode(() => setOtp(""))}
            disabled={clocks.resendIn > 0 || forgot.isPending}
          >
            {clocks.resendIn > 0 ? `Gửi lại mã (${clocks.resendIn}s)` : "Gửi lại mã"}
          </button>
          <button type="button" className="link-button" onClick={() => { setStep("email"); setFormError(""); setPassword(""); setConfirmation(""); setOtp(""); }}>
            Đổi email
          </button>
        </form>
      )}
    </main>
  );
}
