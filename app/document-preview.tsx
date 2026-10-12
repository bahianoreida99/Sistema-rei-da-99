"use client";
import { useEffect, useRef, useState } from "react";
import { supabase, type Doc } from "@/lib/supabase";

export default function DocumentPreview({ document, label, onClose }: { document: Doc; label: string; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = window.document.activeElement as HTMLElement | null;
    close.current?.focus();
    let alive = true;
    let objectUrl = "";
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") { event.preventDefault(); close.current?.focus(); }
    };
    window.addEventListener("keydown", keyboard);
    void (async () => {
      if (!supabase || !document.storage_path) throw Error("Arquivo indisponível");
      const result = await supabase.storage.from("bahiano-documentos").download(document.storage_path);
      if (result.error || !result.data) throw Error("Não foi possível carregar o documento. Feche e tente novamente.");
      if (!alive) return;
      objectUrl = URL.createObjectURL(result.data);
      setUrl(objectUrl);
    })().catch((reason) => { if (alive) setError(reason.message); });
    return () => {
      alive = false;
      window.removeEventListener("keydown", keyboard);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      previous?.focus();
    };
  }, [document.storage_path, onClose]);
  const pdf = /\.pdf$/i.test(document.storage_path || "");
  return <div className="documentOverlay" onClick={onClose}>
    <section className="documentModal" role="dialog" aria-modal="true" aria-label={label} onClick={(event) => event.stopPropagation()}>
      <header><h2>{label}</h2><button ref={close} type="button" onClick={onClose} aria-label="Fechar visualização">Fechar ✕</button></header>
      {error ? <p role="alert">{error}</p> : !url ? <p role="status">Carregando documento…</p> : pdf ? <iframe title={label} src={url} /> : <img src={url} alt={label} onError={() => setError("Não foi possível exibir esta imagem. Use o botão de baixar arquivo.")} />}
    </section>
  </div>;
}
