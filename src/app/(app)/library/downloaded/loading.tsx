export default function Loading() {
  return (
    <div style={{ padding: "clamp(0.75rem, 3vw, 1.25rem)" }}>
      <div style={{ margin: "clamp(-0.75rem, -3vw, -1.25rem) clamp(-0.75rem, -3vw, -1.25rem) clamp(0.75rem, 3vw, 1.25rem)", background: "var(--sakura-skeleton)", padding: "clamp(1rem, 4vw, 1.5rem)", borderRadius: "0 0 16px 16px", opacity: 0.5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "clamp(0.75rem, 3vw, 1rem)" }}>
          <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "50%", background: "var(--sakura-skeleton)" }} />
          <div style={{ width: "clamp(4.5rem, 18vw, 6rem)", height: "clamp(4.5rem, 18vw, 6rem)", borderRadius: "14px", background: "var(--sakura-skeleton)" }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div style={{ width: "3rem", height: "0.6875rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
            <div style={{ width: "8rem", height: "1.25rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
        {[...Array(5)].map((_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0.75rem" }}>
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
