export default function Loading() {
  return (
    <div style={{ padding: "clamp(1rem, 3vw, 1.5rem)", maxWidth: "72rem", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem" }}>
        <div style={{ width: "9rem", height: "1.75rem", borderRadius: "6px", background: "var(--sakura-skeleton)" }} />
        <div style={{ display: "flex", gap: "0.375rem" }}>
          <div style={{ width: "2.25rem", height: "2.25rem", borderRadius: "10px", background: "var(--sakura-skeleton)" }} />
          <div style={{ width: "2.25rem", height: "2.25rem", borderRadius: "10px", background: "var(--sakura-skeleton)" }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        {[...Array(4)].map((_, i) => (
          <div key={i} style={{ width: "4.5rem", height: "2rem", borderRadius: "9999px", background: "var(--sakura-skeleton)" }} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(15rem, 1fr))", gap: "0.625rem", marginBottom: "1.5rem" }}>
        {[...Array(2)].map((_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.875rem", padding: "0.625rem", borderRadius: "12px" }}>
            <div style={{ width: "3.25rem", height: "3.25rem", borderRadius: "8px", background: "var(--sakura-skeleton)", flexShrink: 0 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              <div style={{ width: "60%", height: "0.9375rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
              <div style={{ width: "35%", height: "0.75rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "clamp(0.75rem, 3vw, 1rem)", padding: "0.5rem" }}>
            <div style={{ width: "clamp(3rem, 10vw, 3.5rem)", height: "clamp(3rem, 10vw, 3.5rem)", borderRadius: "8px", background: "var(--sakura-skeleton)", flexShrink: 0 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              <div style={{ width: "55%", height: "0.875rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
              <div style={{ width: "35%", height: "0.75rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
