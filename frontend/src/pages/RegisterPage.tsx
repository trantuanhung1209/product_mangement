import { useState } from "react";
import { ArrowRight, MailCheck } from "lucide-react";
import { Link, Navigate } from "react-router-dom";

import { getApiFieldErrors } from "../api/errors";
import { useAuth } from "../auth/AuthContext";
import { PasswordInput } from "../components/feedback/PasswordInput";
import { PasswordRulesList } from "../components/feedback/PasswordRulesList";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useOtpClocks } from "../hooks/useOtpClocks";
import {
  useRequestRegistrationOtp,
  useResendRegistrationOtp,
  useVerifyRegistrationOtp,
} from "../hooks/useRegistration";
import { describeError, formatClock, waitSeconds } from "../utils/authErrors";
import { passwordProblems } from "../utils/passwordRules";

export function RegisterPage() {
  useDocumentTitle("Đăng ký");
  const { user } = useAuth();
  const requestOtp = useRequestRegistrationOtp();
  const resendOtp = useResendRegistrationOtp();
  const verifyOtp = useVerifyRegistrationOtp();
  const [step, setStep] = useState<"details" | "otp">("details");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [otp, setOtp] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const clocks = useOtpClocks(step === "otp");

  if (user) return <Navigate to="/shop" replace />;

  const submitDetails = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    const errors: Record<string, string> = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) errors.email = "Email không hợp lệ.";
    const problems = passwordProblems(password);
    if (problems.length) errors.password = problems[0];
    if (confirmation !== password) errors.confirmation = "Mật khẩu xác nhận không khớp.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    requestOtp.mutate(
      { email: email.trim(), password },
      {
        onSuccess: (timings) => {
          // The password is only needed for this request; drop it from memory before step two.
          setPassword("");
          setConfirmation("");
          setOtp("");
          clocks.start(timings);
          setStep("otp");
        },
        onError: (error) => {
          const apiErrors = getApiFieldErrors(error);
          if (apiErrors.email || apiErrors.password) {
            setFieldErrors({ email: apiErrors.email ?? "", password: apiErrors.password ?? "" });
          } else {
            setFormError(describeError(error));
          }
        },
      },
    );
  };

  const submitOtp = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    verifyOtp.mutate(
      { email: email.trim(), otp },
      { onError: (error) => setFormError(getApiFieldErrors(error).otp ?? describeError(error)) },
    );
  };

  const resend = () => {
    setFormError("");
    resendOtp.mutate(email.trim(), {
      onSuccess: (timings) => {
        setOtp("");
        clocks.start(timings);
      },
      onError: (error) => {
        const wait = waitSeconds(error);
        if (wait !== null) {
          clocks.holdResendFor(wait);
        }
        setFormError(describeError(error));
      },
    });
  };

  return (
    <main className="login-page">
      <section className="login-intro">
        <span className="brand-mark">
          <MailCheck size={20} aria-hidden="true" />
        </span>
        <p className="eyebrow">PRODUCT CATALOG</p>
        <h1>Tạo tài khoản<br />chỉ trong vài bước.</h1>
        <p>Xác minh email bằng mã gồm 6 chữ số để bắt đầu mua sắm.</p>
      </section>
      {step === "details" ? (
        <form className="login-card" onSubmit={submitDetails} noValidate>
          <p className="eyebrow">ĐĂNG KÝ</p>
          <h2>Tạo tài khoản</h2>
          <p>Nhập email và đặt mật khẩu cho tài khoản mới.</p>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <div className="password-field-group">
            <label htmlFor="register-email">Email</label>
            <input
              id="register-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="ban@example.com"
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? "register-email-error" : undefined}
              autoFocus
            />
            {fieldErrors.email && <small className="field-error" id="register-email-error">{fieldErrors.email}</small>}
          </div>
          <PasswordInput
            label="Mật khẩu"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            error={fieldErrors.password}
            describedBy="password-rules"
          />
          <PasswordRulesList password={password} id="password-rules" />
          <PasswordInput
            label="Xác nhận mật khẩu"
            value={confirmation}
            onChange={setConfirmation}
            autoComplete="new-password"
            error={fieldErrors.confirmation}
          />
          <button className="primary-button login-submit" disabled={requestOtp.isPending}>
            {requestOtp.isPending ? "Đang gửi mã..." : <>Gửi mã xác minh <ArrowRight size={16} aria-hidden="true" /></>}
          </button>
          <p className="auth-switch">Đã có tài khoản? <Link to="/login">Đăng nhập</Link></p>
        </form>
      ) : (
        <form className="login-card" onSubmit={submitOtp}>
          <p className="eyebrow">XÁC MINH EMAIL</p>
          <h2>Nhập mã xác minh</h2>
          <p>Nếu email hợp lệ, mã 6 chữ số đã được gửi tới <strong>{email.trim()}</strong>.</p>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <div className="password-field-group">
            <label htmlFor="register-otp">Mã xác minh</label>
            <input
              id="register-otp"
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
          <button className="primary-button login-submit" disabled={verifyOtp.isPending || otp.length !== 6 || clocks.expired}>
            {verifyOtp.isPending ? "Đang xác minh..." : "Xác minh và đăng ký"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={resend}
            disabled={clocks.resendIn > 0 || resendOtp.isPending}
          >
            {clocks.resendIn > 0 ? `Gửi lại mã (${clocks.resendIn}s)` : "Gửi lại mã"}
          </button>
          <button type="button" className="link-button" onClick={() => { setStep("details"); setFormError(""); setOtp(""); }}>
            Đổi email hoặc mật khẩu
          </button>
        </form>
      )}
    </main>
  );
}
