import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { trpc } from "@/providers/trpc";
import { SiteLayout } from "@/components/SiteLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Coins,
  Ticket,
  KeyRound,
  Loader2,
  Copy,
  RefreshCw,
  ReceiptText,
  User as UserIcon,
  ShieldCheck,
  Camera,
  Save,
  LockKeyhole,
  Mail,
  ShoppingCart,
} from "lucide-react";
import { toast } from "sonner";
import { LOGIN_PATH } from "@/const";
import { cn } from "@/lib/utils";

const LOG_TYPE_CLS: Record<string, string> = {
  redeem: "bg-emerald-500/15 text-emerald-600 border-emerald-500/40",
  generate: "bg-sky-500/12 text-sky-600 border-violet-400/40",
  refund: "bg-blue-500/15 text-blue-600 border-blue-500/40",
  admin_adjust: "bg-amber-500/15 text-amber-600 border-amber-500/40",
};

export default function Settings() {
  const { user, isLoading } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: LOGIN_PATH,
  });
  const { t, lang } = useI18n();
  const utils = trpc.useUtils();
  const [cardCode, setCardCode] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [codeCooldown, setCodeCooldown] = useState(0);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const profileQuery = trpc.user.profile.useQuery(undefined, {
    enabled: !!user,
  });
  const logsQuery = trpc.user.creditLogs.useQuery(
    { limit: 30 },
    { enabled: !!user }
  );

  useEffect(() => {
    if (profileQuery.data?.name) setProfileName(profileQuery.data.name);
  }, [profileQuery.data?.name]);

  useEffect(() => {
    if (codeCooldown <= 0) return;
    const timer = window.setInterval(
      () => setCodeCooldown(value => Math.max(0, value - 1)),
      1000
    );
    return () => window.clearInterval(timer);
  }, [codeCooldown]);

  const refreshProfile = async () => {
    await Promise.all([
      utils.user.profile.invalidate(),
      utils.auth.me.invalidate(),
    ]);
  };

  const updateProfileMutation = trpc.user.updateProfile.useMutation({
    onSuccess: async () => {
      toast.success(t("settings.profileSaved"));
      await refreshProfile();
    },
    onError: err => toast.error(err.message),
  });

  const updateAvatarMutation = trpc.user.updateAvatar.useMutation({
    onSuccess: async () => {
      toast.success(t("settings.avatarUpdated"));
      await refreshProfile();
    },
    onError: err => toast.error(err.message),
  });

  const sendPasswordCodeMutation = trpc.user.sendPasswordCode.useMutation({
    onSuccess: result => {
      toast.success(`${t("settings.codeSent")} ${result.email}`);
      setCodeCooldown(result.cooldownSeconds);
    },
    onError: err => toast.error(err.message),
  });

  const changePasswordMutation = trpc.user.changePassword.useMutation({
    onSuccess: () => {
      toast.success(t("settings.passwordChanged"));
      setVerificationCode("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: err => toast.error(err.message),
  });

  const redeemMutation = trpc.user.redeemCard.useMutation({
    onSuccess: res => {
      toast.success(
        `${t("settings.redeemOk")} +${res.credits} → ${res.balance}`
      );
      setCardCode("");
      utils.user.profile.invalidate();
      utils.user.creditLogs.invalidate();
    },
    onError: err => toast.error(err.message),
  });

  const rotateKeyMutation = trpc.user.rotateApiKey.useMutation({
    onSuccess: () => {
      toast.success(t("settings.keyOk"));
      setShowKey(true);
      utils.user.profile.invalidate();
    },
  });

  if (isLoading || !user) {
    return (
      <SiteLayout>
        <div className="flex h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
        </div>
      </SiteLayout>
    );
  }

  const profile = profileQuery.data;
  const quota = profile?.quota ?? user.quota;
  const apiKey = profile?.apiKey;
  const displayUser = profile ?? user;

  const uploadAvatar = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t("settings.avatarTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        updateAvatarMutation.mutate({ dataUrl: reader.result });
      }
    };
    reader.onerror = () => toast.error(t("settings.avatarReadFailed"));
    reader.readAsDataURL(file);
  };

  const submitPasswordChange = () => {
    if (newPassword !== confirmPassword) {
      toast.error(t("settings.passwordMismatch"));
      return;
    }
    changePasswordMutation.mutate({
      code: verificationCode,
      newPassword,
    });
  };

  const LOG_TYPE_LABEL: Record<string, { label: string; cls: string }> = {
    redeem: { label: t("settings.logRedeem"), cls: LOG_TYPE_CLS.redeem },
    generate: { label: t("settings.logGenerate"), cls: LOG_TYPE_CLS.generate },
    refund: { label: t("settings.logRefund"), cls: LOG_TYPE_CLS.refund },
    admin_adjust: {
      label: t("settings.logAdminAdjust"),
      cls: LOG_TYPE_CLS.admin_adjust,
    },
  };

  return (
    <SiteLayout>
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10 space-y-6">
        <h1 className="text-3xl font-bold text-slate-900">
          {t("settings.title")}
        </h1>

        {/* 个人资料 */}
        <section className="glass-card rounded-2xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-5 text-slate-800">
            <UserIcon className="h-5 w-5 text-sky-500" />
            {t("settings.profile")}
          </h2>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <Avatar className="h-16 w-16 ring-2 ring-violet-400/50">
              <AvatarImage src={displayUser.avatar ?? undefined} />
              <AvatarFallback className="bg-violet-500 text-xl text-white">
                {(displayUser.name ?? "U").slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold text-slate-800">
                  {displayUser.name ?? t("settings.unnamed")}
                </span>
                {displayUser.role === "admin" && (
                  <Badge className="bg-fuchsia-500/15 text-fuchsia-600 border-fuchsia-500/40">
                    <ShieldCheck className="mr-1 h-3 w-3" />
                    {t("settings.admin")}
                  </Badge>
                )}
                <Badge
                  className={
                    displayUser.status === "active"
                      ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/40"
                      : "bg-red-500/15 text-red-600 border-red-500/40"
                  }
                >
                  {displayUser.status === "active"
                    ? t("settings.active")
                    : t("settings.banned")}
                </Badge>
              </div>
              <p className="text-sm text-slate-500 mt-1">
                {displayUser.email ?? "—"}
              </p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1.5 text-2xl font-extrabold text-amber-500">
                <Coins className="h-6 w-6" />
                {quota}
              </div>
              <div className="text-xs text-slate-500">
                {t("settings.quotaLabel")}
              </div>
            </div>
          </div>
          <div className="mt-6 grid gap-4 border-t border-slate-200 pt-5 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">
                {t("settings.username")}
              </span>
              <Input
                value={profileName}
                onChange={event => setProfileName(event.target.value)}
                className="h-11 bg-white/85 border-slate-300"
                minLength={2}
                maxLength={40}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={event => {
                  uploadAvatar(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="h-11 border-slate-300 text-slate-700"
                disabled={updateAvatarMutation.isPending}
                onClick={() => avatarInputRef.current?.click()}
              >
                {updateAvatarMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="mr-2 h-4 w-4" />
                )}
                {t("settings.uploadAvatar")}
              </Button>
              <Button
                type="button"
                className="h-11 bg-slate-900 px-5 text-white hover:bg-slate-800"
                disabled={
                  updateProfileMutation.isPending ||
                  profileName.trim().length < 2 ||
                  profileName.trim() === (displayUser.name ?? "")
                }
                onClick={() =>
                  updateProfileMutation.mutate({ name: profileName })
                }
              >
                {updateProfileMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {t("settings.saveProfile")}
              </Button>
            </div>
          </div>
        </section>

        <section className="glass-card rounded-2xl p-6">
          <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-slate-800">
            <LockKeyhole className="h-5 w-5 text-violet-500" />
            {t("settings.securityTitle")}
          </h2>
          <p className="mb-5 text-sm text-slate-500">
            {displayUser.email ?? "—"}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">
                {t("settings.emailCode")}
              </span>
              <div className="flex gap-2">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={verificationCode}
                  onChange={event =>
                    setVerificationCode(
                      event.target.value.replace(/\D/g, "").slice(0, 6)
                    )
                  }
                  placeholder="000000"
                  className="h-11 min-w-0 bg-white/85 border-slate-300 font-mono text-base"
                  maxLength={6}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 shrink-0 border-slate-300 text-slate-700"
                  disabled={
                    sendPasswordCodeMutation.isPending || codeCooldown > 0
                  }
                  onClick={() => sendPasswordCodeMutation.mutate()}
                >
                  {sendPasswordCodeMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="mr-2 h-4 w-4" />
                  )}
                  {codeCooldown > 0
                    ? `${codeCooldown}s`
                    : t("settings.sendCode")}
                </Button>
              </div>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">
                {t("settings.newPassword")}
              </span>
              <Input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
                className="h-11 bg-white/85 border-slate-300"
                minLength={8}
                maxLength={128}
              />
            </label>
            <label className="grid gap-2 sm:col-start-2">
              <span className="text-sm font-medium text-slate-700">
                {t("settings.confirmPassword")}
              </span>
              <Input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                className="h-11 bg-white/85 border-slate-300"
                minLength={8}
                maxLength={128}
              />
            </label>
          </div>
          <div className="mt-5 flex justify-end">
            <Button
              type="button"
              className="h-11 bg-violet-600 px-6 text-white hover:bg-violet-500"
              disabled={
                changePasswordMutation.isPending ||
                verificationCode.length !== 6 ||
                newPassword.length < 8 ||
                confirmPassword.length < 8
              }
              onClick={submitPasswordChange}
            >
              {changePasswordMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t("settings.changePassword")}
            </Button>
          </div>
        </section>

        {/* 卡密兑换 */}
        <section className="glass-card rounded-2xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-2 text-slate-800">
            <Ticket className="h-5 w-5 text-emerald-500" />
            {t("settings.redeemTitle")}
          </h2>
          <p className="text-sm text-slate-500 mb-4">
            {t("settings.redeemSub")}
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              value={cardCode}
              onChange={e => setCardCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              className="font-mono tracking-wider bg-white/85 border-slate-300 focus:border-violet-400 h-11"
              maxLength={19}
            />
            <Button
              className="h-11 px-8 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white border-0 shrink-0"
              disabled={redeemMutation.isPending || cardCode.trim().length < 4}
              onClick={() => redeemMutation.mutate({ code: cardCode })}
            >
              {redeemMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Ticket className="mr-2 h-4 w-4" />
              )}
              {t("settings.redeemBtn")}
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-11 shrink-0 border-amber-300 bg-amber-50/85 px-5 text-amber-700 hover:bg-amber-100 hover:text-amber-800"
            >
              <a
                href="https://catfk.com/shop/aoteman"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ShoppingCart className="h-4 w-4" />
                {t("settings.buyCard")}
              </a>
            </Button>
          </div>
        </section>

        {/* API Key */}
        <section className="glass-card rounded-2xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-2 text-slate-800">
            <KeyRound className="h-5 w-5 text-amber-500" />
            {t("settings.apikeyTitle")}
          </h2>
          <p className="text-sm text-slate-500 mb-4">
            {t("settings.apikeySub")}{" "}
            <a href="/docs" className="text-sky-600 hover:underline">
              {t("settings.apikeyDoc")}
            </a>
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <div
              className="flex-1 flex items-center rounded-lg border border-slate-300 bg-white/85 px-4 h-11 font-mono text-sm text-slate-600 cursor-pointer select-none"
              onClick={() => apiKey && setShowKey(!showKey)}
              title={apiKey ? t("settings.showHide") : ""}
            >
              {apiKey ? (
                showKey ? (
                  apiKey
                ) : (
                  `${apiKey.slice(0, 7)}${"•".repeat(20)}${apiKey.slice(-4)}`
                )
              ) : (
                <span className="text-slate-400">{t("settings.noKey")}</span>
              )}
            </div>
            {apiKey && (
              <Button
                variant="outline"
                className="h-11 border-slate-300 text-slate-600 shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(apiKey);
                  toast.success(t("settings.keyCopied"));
                }}
              >
                <Copy className="mr-2 h-4 w-4" />
                {t("settings.copy")}
              </Button>
            )}
            <Button
              variant="outline"
              className="h-11 border-amber-500/50 text-amber-600 hover:bg-amber-500/10 shrink-0"
              disabled={rotateKeyMutation.isPending}
              onClick={() => {
                if (apiKey && !confirm(t("settings.resetConfirm"))) return;
                rotateKeyMutation.mutate();
              }}
            >
              <RefreshCw
                className={cn(
                  "mr-2 h-4 w-4",
                  rotateKeyMutation.isPending && "animate-spin"
                )}
              />
              {apiKey ? t("settings.resetKey") : t("settings.genKey")}
            </Button>
          </div>
        </section>

        {/* 额度流水 */}
        <section className="glass-card rounded-2xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-5 text-slate-800">
            <ReceiptText className="h-5 w-5 text-sky-500" />
            {t("settings.logsTitle")}
          </h2>
          {logsQuery.data && logsQuery.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="pb-3 pr-4 font-medium">
                      {t("settings.colType")}
                    </th>
                    <th className="pb-3 pr-4 font-medium">
                      {t("settings.colAmount")}
                    </th>
                    <th className="pb-3 pr-4 font-medium">
                      {t("settings.colBalance")}
                    </th>
                    <th className="pb-3 pr-4 font-medium">
                      {t("settings.colRemark")}
                    </th>
                    <th className="pb-3 font-medium">
                      {t("settings.colTime")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {logsQuery.data.map(log => {
                    const meta = LOG_TYPE_LABEL[log.type] ?? {
                      label: log.type,
                      cls: "bg-slate-100 text-slate-500 border-slate-300",
                    };
                    return (
                      <tr
                        key={log.id}
                        className="border-b border-slate-200/60 last:border-0"
                      >
                        <td className="py-3 pr-4">
                          <Badge className={cn("border", meta.cls)}>
                            {meta.label}
                          </Badge>
                        </td>
                        <td
                          className={cn(
                            "py-3 pr-4 font-mono font-semibold",
                            log.amount > 0 ? "text-emerald-600" : "text-red-500"
                          )}
                        >
                          {log.amount > 0 ? `+${log.amount}` : log.amount}
                        </td>
                        <td className="py-3 pr-4 font-mono text-slate-500">
                          {log.balanceAfter}
                        </td>
                        <td className="py-3 pr-4 text-slate-500 text-xs">
                          {log.remark ?? "—"}
                        </td>
                        <td className="py-3 text-slate-500 text-xs whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString(
                            lang === "zh" ? "zh-CN" : "en-US"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">
              {t("settings.noLogs")}
            </p>
          )}
        </section>
      </div>
    </SiteLayout>
  );
}
