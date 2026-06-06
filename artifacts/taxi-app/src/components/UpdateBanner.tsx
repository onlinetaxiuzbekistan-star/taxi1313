import { useVersionCheck } from "@/hooks/use-version-check";

export function UpdateBanner() {
  const { updateAvailable, forceUpdate, applyUpdate, dismissUpdate } = useVersionCheck();

  if (!updateAvailable) return null;

  return (
    <div style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
      zIndex: 99999, background: forceUpdate ? "#dc2626" : "#1e293b", color: "#fff",
      padding: "12px 24px", borderRadius: 12,
      boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
      display: "flex", alignItems: "center", gap: 16, fontSize: 14,
      fontFamily: "Inter, sans-serif", maxWidth: "90vw",
    }}>
      <span>
        {forceUpdate
          ? "Критическое обновление! Страница обновится автоматически через 10 сек"
          : "Доступно обновление приложения"}
      </span>
      <button onClick={applyUpdate} style={{
        background: forceUpdate ? "#fff" : "#f59e0b",
        color: forceUpdate ? "#dc2626" : "#000",
        border: "none", padding: "8px 20px",
        borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 14, whiteSpace: "nowrap",
      }}>
        Обновить сейчас
      </button>
      {!forceUpdate && (
        <button onClick={dismissUpdate} style={{
          background: "transparent", color: "#94a3b8", border: "none",
          cursor: "pointer", fontSize: 18, padding: "0 4px", lineHeight: 1,
        }}>
          \u2715
        </button>
      )}
    </div>
  );
}
