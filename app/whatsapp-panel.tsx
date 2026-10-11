"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

const PREPARE_TIMEOUT = 20000;
const QR_WINDOW = 60000;
export default function WhatsappPanel() {
  const [status, setStatus] = useState("LOADING");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [qr, setQr] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const flow = useRef({
    generation: 0,
    requested: false,
    prepareUntil: 0,
    qrUntil: 0,
    hash: "",
    objectUrl: "",
    actionPending: false,
  });
  const connected = status === "WORKING";
  const clearQr = useCallback(() => {
    if (flow.current.objectUrl) URL.revokeObjectURL(flow.current.objectUrl);
    flow.current.objectUrl = "";
    flow.current.hash = "";
    flow.current.qrUntil = 0;
    setQr("");
    setRemaining(0);
  }, []);
  const request = useCallback(
    async (action: string, method = "GET", signal?: AbortSignal) => {
      let authTimer: ReturnType<typeof setTimeout> | undefined;
      const { data } = await Promise.race([
        supabase!.auth.getSession(),
        new Promise<never>((_, reject) => {
          authTimer = setTimeout(
            () =>
              reject(
                Error("Sua sessão não respondeu. Entre novamente no painel."),
              ),
            5000,
          );
        }),
      ]).finally(() => clearTimeout(authTimer));
      if (!data.session) throw Error("Entre novamente no painel.");
      const response = await fetch(
        process.env.NEXT_PUBLIC_API_URL + "/admin/whatsapp/" + action,
        {
          method,
          cache: "no-store",
          signal: AbortSignal.any([
            AbortSignal.timeout(10000),
            ...(signal ? [signal] : []),
          ]),
          headers: { authorization: "Bearer " + data.session.access_token },
        },
      );
      if (!response.ok)
        throw Error(
          response.status === 401
            ? "Entre novamente no painel."
            : "O WhatsApp não respondeu. Clique em Conectar para tentar novamente.",
        );
      return response;
    },
    [],
  );
  // One loop owns status and QR requests. Polling never restarts the session.
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let latestStatus = "LOADING";
    const poll = async () => {
      const version = flow.current.generation;
      try {
        if (flow.current.actionPending) return;
        const data = await (
          await request("session", "GET", controller.signal)
        ).json();
        if (controller.signal.aborted || version !== flow.current.generation)
          return;
        latestStatus = data.status || "UNAVAILABLE";
        setStatus(latestStatus);
        if (data.connected && latestStatus === "WORKING") {
          flow.current.requested = false;
          setPreparing(false);
          setError("");
          clearQr();
          return;
        }
        if (
          ["PASSKEY_REQUIRED", "PASSKEY_CONFIRMATION_REQUIRED"].includes(
            latestStatus,
          )
        ) {
          flow.current.requested = false;
          setPreparing(false);
          clearQr();
          setError(
            "O WhatsApp pediu uma confirmação adicional. Confira a solicitação no celular antes de continuar.",
          );
          return;
        }
        if (flow.current.requested && latestStatus === "FAILED") {
          flow.current.requested = false;
          setPreparing(false);
          clearQr();
          setError(
            "O WhatsApp interrompeu a conexão. Clique em Conectar para tentar novamente.",
          );
          return;
        }
        if (!flow.current.requested || latestStatus !== "SCAN_QR_CODE") return;
        const blob = await (
          await request("qr", "GET", controller.signal)
        ).blob();
        if (
          controller.signal.aborted ||
          version !== flow.current.generation ||
          !flow.current.requested
        )
          return;
        if (!blob.size || !blob.type.startsWith("image/"))
          throw Error("O WhatsApp retornou um QR Code inválido.");
        const digest = await crypto.subtle.digest(
          "SHA-256",
          await blob.arrayBuffer(),
        );
        const hash = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        if (
          controller.signal.aborted ||
          version !== flow.current.generation ||
          !flow.current.requested
        )
          return;
        if (hash !== flow.current.hash) {
          const oldUrl = flow.current.objectUrl;
          const newUrl = URL.createObjectURL(blob);
          flow.current.objectUrl = newUrl;
          flow.current.hash = hash;
          setQr(newUrl);
          if (oldUrl) URL.revokeObjectURL(oldUrl);
        }
        if (!flow.current.qrUntil)
          flow.current.qrUntil = Date.now() + QR_WINDOW;
        setRemaining(Math.ceil((flow.current.qrUntil - Date.now()) / 1000));
        setPreparing(false);
        setError("");
      } catch (e) {
        if (controller.signal.aborted || version !== flow.current.generation)
          return;
        if (!flow.current.requested) {
          setStatus("UNAVAILABLE");
          setError(
            e instanceof Error && e.name !== "TimeoutError"
              ? e.message
              : "A conexão não respondeu a tempo. Clique em Conectar para tentar novamente.",
          );
        }
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(
            poll,
            flow.current.requested
              ? 1200
              : latestStatus === "WORKING"
                ? 10000
                : 3000,
          );
      }
    };
    void poll();
    const tick = setInterval(() => {
      const current = flow.current;
      if (!current.requested) return;
      if (current.qrUntil) {
        const seconds = Math.max(
          0,
          Math.ceil((current.qrUntil - Date.now()) / 1000),
        );
        setRemaining(seconds);
        if (!seconds) {
          current.requested = false;
          clearQr();
          setPreparing(false);
        }
      } else {
        setElapsed(
          Math.min(
            20,
            Math.floor(
              (Date.now() - (current.prepareUntil - PREPARE_TIMEOUT)) / 1000,
            ),
          ),
        );
        if (Date.now() >= current.prepareUntil) {
          current.requested = false;
          clearQr();
          setPreparing(false);
          setError(
            "O QR Code não ficou pronto em 20 segundos. Clique em Conectar para tentar novamente.",
          );
        }
      }
    }, 250);
    return () => {
      controller.abort();
      flow.current.generation++;
      flow.current.requested = false;
      flow.current.actionPending = false;
      clearTimeout(timer);
      clearInterval(tick);
      if (flow.current.objectUrl) URL.revokeObjectURL(flow.current.objectUrl);
      flow.current.objectUrl = "";
      flow.current.hash = "";
    };
  }, [request, clearQr]);
  const changeConnection = async () => {
    if (flow.current.actionPending) return;
    const disconnect = connected;
    const version = ++flow.current.generation;
    flow.current.actionPending = true;
    flow.current.requested = false;
    clearQr();
    setPreparing(false);
    setError("");
    setBusy(true);
    const controller = new AbortController();
    const deadline = setTimeout(() => {
      controller.abort();
      if (version === flow.current.generation) {
        flow.current.generation++;
        flow.current.actionPending = false;
        setBusy(false);
        setPreparing(false);
        setStatus("UNAVAILABLE");
        setError(
          "A operação não respondeu em 15 segundos. Clique em Conectar para tentar novamente.",
        );
      }
    }, 15000);
    try {
      const data = await (
        await request(
          disconnect ? "disconnect" : "connect",
          "POST",
          controller.signal,
        )
      ).json();
      if (version !== flow.current.generation) return;
      setStatus(data.status);
      if (!disconnect && !data.connected) {
        flow.current.requested = true;
        flow.current.prepareUntil = Date.now() + PREPARE_TIMEOUT;
        setPreparing(true);
        setElapsed(0);
      }
    } catch (e) {
      if (version === flow.current.generation)
        setError(
          e instanceof Error && !["TimeoutError", "AbortError"].includes(e.name)
            ? e.message
            : "A operação não respondeu a tempo. Clique em Conectar novamente.",
        );
    } finally {
      clearTimeout(deadline);
      if (version === flow.current.generation) {
        flow.current.actionPending = false;
        setBusy(false);
      }
    }
  };
  return (
    <section className="panel whatsappPanel">
      <div className="whatsappHeader">
        <div className="whatsappIdentity">
          <MessageCircle size={26} />
          <div>
            <h2>WhatsApp</h2>
            <span
              className={
                connected ? "connectionBadge connected" : "connectionBadge"
              }
            >
              {connected && <CheckCircle2 size={16} />}{" "}
              {connected
                ? "Conectado"
                : busy || preparing || status === "STARTING"
                  ? "Conectando…"
                  : "Desconectado"}
            </span>
          </div>
        </div>
        <button
          className={
            connected
              ? "smallAction disconnectButton"
              : "smallAction connectButton"
          }
          disabled={busy || preparing || status === "LOADING"}
          onClick={() => void changeConnection()}
        >
          {busy ? "Aguarde…" : connected ? "Desconectar" : "Conectar"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {(preparing || qr) && !connected && (
        <div className="qrConnection">
          {qr ? (
            <img
              src={qr}
              width={276}
              height={276}
              alt="QR Code para conectar o WhatsApp do Bahiano"
            />
          ) : (
            <p>Preparando seu QR Code… {elapsed}s / 20s</p>
          )}
          {qr && <strong>Tempo restante: {remaining}s</strong>}
          <p>No WhatsApp, abra Aparelhos conectados → Conectar aparelho.</p>
        </div>
      )}
      {!preparing && !qr && !connected && !error && (
        <p className="muted">
          Clique em Conectar para exibir o QR Code por um minuto.
        </p>
      )}
    </section>
  );
}
