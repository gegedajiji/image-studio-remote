import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  ArrowRight,
  BadgeCheck,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  Sparkles,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { BackgroundManager } from "@/components/effects/BackgroundManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import {
  normalizeRegistrationEmail,
  sanitizeVerificationCode,
  validateLoginSubmission,
  validateRegistrationSubmission,
} from "./loginForm";

type Mode = "login" | "register";

export default function Login() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [registrationCodeEmail, setRegistrationCodeEmail] = useState("");
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);

  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  useEffect(() => {
    if (me.data) navigate("/workspace", { replace: true });
  }, [me.data, navigate]);

  useEffect(() => {
    if (codeCooldown <= 0) return;
    const timer = window.setInterval(
      () => setCodeCooldown(value => Math.max(0, value - 1)),
      1000
    );
    return () => window.clearInterval(timer);
  }, [codeCooldown]);

  const finishAuth = async () => {
    await utils.auth.me.invalidate();
    navigate("/workspace", { replace: true });
  };
  const login = trpc.auth.login.useMutation({
    onSuccess: finishAuth,
    onError: error => toast.error(error.message),
  });
  const register = trpc.auth.register.useMutation({
    onSuccess: finishAuth,
    onError: error => toast.error(error.message),
  });
  const sendRegistrationCode = trpc.auth.sendRegistrationCode.useMutation({
    onSuccess: result => {
      setCodeCooldown(result.cooldownSeconds);
      toast.success(`验证码已发送至 ${result.email}`);
    },
    onError: error => {
      setRegistrationCodeEmail("");
      toast.error(error.message);
    },
  });
  const isPending = login.isPending || register.isPending;

  const selectMode = (nextMode: Mode) => {
    setMode(nextMode);
    login.reset();
    register.reset();
    sendRegistrationCode.reset();
  };

  const requestRegistrationCode = () => {
    const normalizedEmail = normalizeRegistrationEmail(email);
    const validationError = validateLoginSubmission(
      normalizedEmail,
      "12345678"
    );
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setRegistrationCodeEmail(normalizedEmail);
    sendRegistrationCode.mutate({ email: normalizedEmail });
  };

  const updateEmail = (value: string) => {
    setEmail(value);
    if (
      registrationCodeEmail &&
      normalizeRegistrationEmail(value) !== registrationCodeEmail
    ) {
      setVerificationCode("");
      setRegistrationCodeEmail("");
      setCodeCooldown(0);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === "register") {
      const validationError = validateRegistrationSubmission({
        name,
        email,
        password,
        confirmPassword,
        code: verificationCode,
      });
      if (validationError) {
        toast.error(validationError);
        return;
      }
      register.mutate({
        name: name.trim(),
        email: normalizeRegistrationEmail(email),
        password,
        code: verificationCode,
      });
      return;
    }
    const validationError = validateLoginSubmission(email, password);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    login.mutate({ email: normalizeRegistrationEmail(email), password });
  };

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-6">
      <BackgroundManager />
      <div
        className="hero-grid-bg fixed inset-0 z-[1] opacity-40"
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center justify-center">
        <section className="grid w-full max-w-5xl overflow-hidden rounded-lg border border-white/70 bg-white/70 shadow-[0_28px_90px_rgba(51,65,120,0.22)] backdrop-blur-2xl lg:grid-cols-[1.08fr_0.92fr]">
          <div className="relative hidden min-h-[610px] overflow-hidden border-r border-white/70 p-12 lg:flex lg:flex-col lg:justify-between">
            <div className="absolute inset-0 bg-[url('/bg/crystal.jpg')] bg-cover bg-center opacity-80" />
            <div className="absolute inset-0 bg-gradient-to-b from-white/30 via-sky-950/5 to-slate-950/60" />

            <button
              type="button"
              onClick={() => navigate("/")}
              className="relative flex w-fit items-center gap-3 text-left"
              aria-label="返回幻镜 AI 首页"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-white/90 shadow-lg">
                <Sparkles className="h-5 w-5 text-sky-600" />
              </span>
              <span className="text-lg font-bold text-slate-900">幻镜 AI</span>
            </button>

            <div className="relative max-w-md text-white">
              <p className="mb-4 text-xs font-semibold uppercase text-sky-100">
                AI Image Workstation
              </p>
              <h1 className="text-4xl font-bold leading-tight">
                让每一个想象，拥有清晰的形状。
              </h1>
              <p className="mt-5 max-w-sm text-sm leading-7 text-slate-100/90">
                从提示词到作品管理，在一个安静、专注的创作空间里完成。
              </p>
            </div>
          </div>

          <div className="flex min-h-[560px] flex-col justify-center px-6 py-10 sm:px-12 lg:min-h-[610px]">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="mb-10 flex w-fit items-center gap-2 lg:hidden"
              aria-label="返回幻镜 AI 首页"
            >
              <Sparkles className="h-5 w-5 text-sky-600" />
              <span className="font-bold text-slate-900">幻镜 AI</span>
            </button>

            <div>
              <p className="text-sm font-medium text-sky-600">
                欢迎来到创作空间
              </p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">
                {mode === "login" ? "登录你的账号" : "创建一个新账号"}
              </h2>
            </div>

            <div
              className="mt-7 grid grid-cols-2 rounded-md bg-slate-100 p-1"
              role="tablist"
            >
              {(["login", "register"] as const).map(item => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={mode === item}
                  onClick={() => selectMode(item)}
                  className={cn(
                    "h-9 rounded-sm text-sm font-medium transition-all",
                    mode === item
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  {item === "login" ? "登录" : "注册"}
                </button>
              ))}
            </div>

            <form className="mt-7 space-y-4" onSubmit={submit} noValidate>
              {mode === "register" && (
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    昵称
                  </span>
                  <span className="relative block">
                    <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={name}
                      onChange={event => setName(event.target.value)}
                      autoComplete="name"
                      placeholder="你的创作者昵称"
                      className="h-11 bg-white/80 pl-10"
                      minLength={2}
                      maxLength={40}
                      required
                    />
                  </span>
                </label>
              )}

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  邮箱
                </span>
                <span className="relative block">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    type="email"
                    value={email}
                    onChange={event => updateEmail(event.target.value)}
                    autoComplete="email"
                    placeholder="name@example.com"
                    className="h-11 bg-white/80 pl-10"
                    maxLength={320}
                    required
                  />
                </span>
              </label>

              {mode === "register" && (
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    邮箱验证码
                  </span>
                  <span className="flex gap-2">
                    <span className="relative min-w-0 flex-1">
                      <BadgeCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={verificationCode}
                        onChange={event =>
                          setVerificationCode(
                            sanitizeVerificationCode(event.target.value)
                          )
                        }
                        placeholder="000000"
                        className="h-11 bg-white/80 pl-10 font-mono text-base"
                        maxLength={6}
                        aria-label="邮箱验证码"
                      />
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-32 shrink-0 border-slate-300 bg-white/80 px-2 text-slate-700 hover:bg-white"
                      disabled={
                        sendRegistrationCode.isPending || codeCooldown > 0
                      }
                      onClick={requestRegistrationCode}
                    >
                      {sendRegistrationCode.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Mail className="h-4 w-4" />
                      )}
                      {sendRegistrationCode.isPending
                        ? "发送中"
                        : codeCooldown > 0
                          ? `${codeCooldown}s 后重发`
                          : "发送验证码"}
                    </Button>
                  </span>
                </label>
              )}

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  密码
                </span>
                <span className="relative block">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    placeholder="至少 8 位密码"
                    className="h-11 bg-white/80 pl-10 pr-10"
                    minLength={8}
                    maxLength={128}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(visible => !visible)}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-slate-400 hover:text-slate-700"
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </span>
              </label>

              {mode === "register" && (
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    确认密码
                  </span>
                  <span className="relative block">
                    <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={event => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder="再次输入密码"
                      className="h-11 bg-white/80 pl-10"
                      minLength={8}
                      maxLength={128}
                      required
                    />
                  </span>
                </label>
              )}

              <Button
                type="submit"
                size="lg"
                disabled={isPending || sendRegistrationCode.isPending}
                className="mt-2 h-11 w-full bg-slate-900 text-white hover:bg-slate-800"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {mode === "login" ? "进入工作台" : "创建账号"}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            <p className="mt-6 text-center text-xs leading-5 text-slate-500">
              {mode === "register"
                ? "注册即代表你同意妥善保管自己的账号凭据。"
                : "使用你的幻镜 AI 本地账号继续。"}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
