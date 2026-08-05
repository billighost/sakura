export default function Loading() {
  return (
    <div style={{ padding: "clamp(0.75rem, 3vw, 1.25rem)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <div style={{ width: "8rem", height: "1.5rem", borderRadius: "6px", background: "var(--sakura-skeleton)" }} />
      </div>
      <div style={{ display: "flex", gap: "0.375rem", marginBottom: "1rem" }}>
        {[...Array(4)].map((_, i) => (
          <div key={i} style={{ width: "4rem", height: "1.75rem", borderRadius: "9999px", background: "var(--sakura-skeleton)" }} />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
        {[...Array(8)].map((_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "clamp(0.75rem, 3vw, 1rem)", padding: "0.5rem 0" }}>
            <div style={{ width: "clamp(3rem, 10vw, 3.5rem)", height: "clamp(3rem, 10vw, 3.5rem)", borderRadius: "8px", background: "var(--sakura-skeleton)", flexShrink: 0 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              <div style={{ width: "60%", height: "0.875rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
              <div style={{ width: "40%", height: "0.75rem", borderRadius: "4px", background: "var(--sakura-skeleton)", opacity: 0.6 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
