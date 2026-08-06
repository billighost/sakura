export default function Loading() {
  return (
    <div style={{ padding: "clamp(1rem, 3vw, 1.5rem)", maxWidth: "72rem", margin: "0 auto" }}>
      <div style={{ margin: "clamp(-1rem, -3vw, -1.5rem) clamp(-1rem, -3vw, -1.5rem) clamp(1.25rem, 4vw, 2rem)", padding: "clamp(2rem, 7vw, 3.25rem) clamp(1.25rem, 4vw, 2rem) clamp(1.5rem, 5vw, 2.25rem)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "clamp(1rem, 3vw, 1.5rem)" }}>
          <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "50%", background: "var(--sakura-skeleton)", flexShrink: 0 }} />
          <div style={{ width: "clamp(6rem, 22vw, 9rem)", height: "clamp(6rem, 22vw, 9rem)", borderRadius: "20px", background: "var(--sakura-skeleton)", flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div style={{ width: "4rem", height: "0.75rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
            <div style={{ width: "10rem", height: "2rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
            <div style={{ width: "6rem", height: "0.8125rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.625rem", marginBottom: "1.25rem" }}>
        <div style={{ width: "6rem", height: "2.5rem", borderRadius: "9999px", background: "var(--sakura-skeleton)" }} />
        <div style={{ width: "6rem", height: "2.5rem", borderRadius: "9999px", background: "var(--sakura-skeleton)" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.875rem", padding: "0.625rem 0.5rem" }}>
            <div style={{ width: "3rem", height: "3rem", borderRadius: "8px", background: "var(--sakura-skeleton)", flexShrink: 0 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ width: "70%", height: "0.875rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
              <div style={{ width: "40%", height: "0.75rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
