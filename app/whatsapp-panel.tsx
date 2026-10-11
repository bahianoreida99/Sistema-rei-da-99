"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function WhatsappPanel() {
  const [status, setStatus] = useState("LOADING");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [qr, setQr] = useState("");
  const [expiresAt, setExpiresAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [awaitingQr, setAwaitingQr] = useState(false);
  const actionPending = useRef(false);
  const generation = useRef(0);
  const connected = status === "WORKING";
  const request = useCallback(async (action: string, method = "GET") => {
    const { data } = await supabase!.auth.getSession();
    if (!data.session) throw Error("Entre novamente no painel.");
    const response = await fetch(
      process.env.NEXT_PUBLIC_API_URL + "/admin/whatsapp/" + action,
      {
        method,
        cache: "no-store",
        signal: AbortSignal.timeout(45000),
        headers: { authorization: "Bearer " + data.session.access_token },
      },
    );
    if (!response.ok)
      throw Error(
        "Não foi possível conectar ao WhatsApp. Tente conectar novamente.",
      );
    return response;
  }, []);
  useEffect(
    () => () => {
      if (qr) URL.revokeObjectURL(qr);
    },
    [qr],
  );
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const version = generation.current;
      try {
        if (!actionPending.current) {
          const data = await (await request("session")).json();
          if (!stopped && version === generation.current) {
            setStatus(data.status);
            setError("");
            if (data.connected) {
              setQr("");
              setExpiresAt(0);
              setAwaitingQr(false);
            }
          }
        }
      } catch {
        if (
          !stopped &&
          version === generation.current &&
          !actionPending.current
        ) {
          setStatus("UNAVAILABLE");
          setError("Conexão indisponível. Use Conectar para tentar novamente.");
        }
      } finally {
        if (!stopped) timer = setTimeout(poll, 3000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [request]);
  useEffect(() => {
    if (!awaitingQr) return;
    const timeout = setTimeout(() => {
      setAwaitingQr(false);
      setError(
        "Não foi possível gerar o QR Code. Clique em Conectar para tentar novamente.",
      );
    }, 45000);
    return () => clearTimeout(timeout);
  }, [awaitingQr]);
  useEffect(() => {
    if (!awaitingQr || status !== "SCAN_QR_CODE") return;
    let stopped = false;
    const version = generation.current;
    void (async () => {
      try {
        const blob = await (await request("qr")).blob();
        if (!stopped && version === generation.current) {
          setQr(URL.createObjectURL(blob));
          setRemaining(60);
          setExpiresAt(Date.now() + 60000);
          setAwaitingQr(false);
        }
      } catch {
        if (!stopped) {
          setAwaitingQr(false);
          setError(
            "Não foi possível gerar o QR Code. Clique em Conectar novamente.",
          );
        }
      }
    })();
    return () => {
      stopped = true;
    };
  }, [awaitingQr, status, request]);
  useEffect(() => {
    if (!expiresAt) return;
    let stopped = false;
    let refreshing = false;
    const version = generation.current;
    const refreshQr = async () => {
      if (refreshing || status !== "SCAN_QR_CODE" || Date.now() >= expiresAt)
        return;
      refreshing = true;
      try {
        const blob = await (await request("qr")).blob();
        if (
          !stopped &&
          version === generation.current &&
          Date.now() < expiresAt
        )
          setQr(URL.createObjectURL(blob));
      } catch {
        if (!stopped) setQr("");
      } finally {
        refreshing = false;
      }
    };
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setRemaining(seconds);
      if (!seconds) {
        setQr("");
        setExpiresAt(0);
      }
    };
    tick();
    void refreshQr();
    const countdown = setInterval(tick, 1000);
    const refresh = setInterval(() => void refreshQr(), 8000);
    return () => {
      stopped = true;
      clearInterval(countdown);
      clearInterval(refresh);
    };
  }, [expiresAt, status, request]);
  const changeConnection = async () => {
    if (actionPending.current) return;
    actionPending.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    setQr("");
    setExpiresAt(0);
    setAwaitingQr(false);
    try {
      const data = await (
        await request(connected ? "disconnect" : "connect", "POST")
      ).json();
      setStatus(data.status);
      if (!connected && !data.connected) {
        setAwaitingQr(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na conexão.");
    } finally {
      actionPending.current = false;
      setBusy(false);
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
                : status === "STARTING"
                  ? "Preparando conexão…"
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
          disabled={busy || status === "LOADING"}
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
      {(awaitingQr || expiresAt > 0) && !connected && (
        <div className="qrConnection">
          {qr ? (
            <img
              src={qr}
              width={276}
              height={276}
              alt="QR Code para conectar o WhatsApp do Bahiano"
            />
          ) : (
            <p>Preparando seu QR Code…</p>
          )}
          {expiresAt > 0 && <strong>Tempo restante: {remaining}s</strong>}
          <p>No WhatsApp, abra Aparelhos conectados → Conectar aparelho.</p>
        </div>
      )}
      {!expiresAt && !awaitingQr && status === "SCAN_QR_CODE" && (
        <p className="muted">
          Clique em Conectar para gerar um novo QR Code por um minuto.
        </p>
      )}
    </section>
  );
}
