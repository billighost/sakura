export default function Loading() {
  return (
    <div>
      <div style={{ padding: "clamp(3.5rem, 10vw, 4.5rem) clamp(1.25rem, 5vw, 2rem) clamp(1.25rem, 4vw, 1.75rem)" }}>
        <div style={{ display: "flex", gap: "clamp(1.25rem, 4vw, 1.75rem)", alignItems: "flex-end" }}>
          <div className="skeleton" style={{ width: "clamp(7rem, 28vw, 11.5rem)", height: "clamp(7rem, 28vw, 11.5rem)", borderRadius: "var(--sakura-radius-lg)", flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: "8px", padding: "0.5rem 0" }}>
            <div className="skeleton" style={{ width: "30%", height: "0.6875rem", borderRadius: "4px" }} />
            <div className="skeleton" style={{ width: "80%", height: "clamp(1.375rem, 4vw, 2rem)", borderRadius: "6px" }} />
            <div className="skeleton" style={{ width: "45%", height: "0.75rem", borderRadius: "4px" }} />
            <div className="skeleton" style={{ width: "35%", height: "0.75rem", borderRadius: "4px" }} />
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.625rem", padding: "0 clamp(1.25rem, 5vw, 2rem)", marginBottom: "1.25rem" }}>
        <div className="skeleton" style={{ width: "6rem", height: "2.75rem", borderRadius: "9999px" }} />
        <div className="skeleton" style={{ width: "2.75rem", height: "2.75rem", borderRadius: "9999px" }} />
        <div className="skeleton" style={{ width: "2.625rem", height: "2.625rem", borderRadius: "9999px", marginLeft: "auto" }} />
      </div>
      <div style={{ padding: "0 clamp(1.25rem, 5vw, 2rem)" }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0" }}>
            <div className="skeleton" style={{ width: "1.25rem", height: "0.8125rem", borderRadius: "4px" }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
              <div className="skeleton" style={{ width: `${55 + ((i * 17) % 35)}%`, height: "0.8125rem", borderRadius: "4px" }} />
              <div className="skeleton" style={{ width: `${25 + ((i * 13) % 20)}%`, height: "0.6875rem", borderRadius: "4px" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
