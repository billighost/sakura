export default function Loading() {
  return (
    <div>
      <div style={{ padding: "clamp(3.5rem, 12vw, 4.5rem) clamp(1.25rem, 5vw, 2rem) clamp(1.75rem, 5vw, 2.25rem)", textAlign: "center" }}>
        <div className="skeleton" style={{ width: "clamp(6.5rem, 26vw, 9.5rem)", height: "clamp(6.5rem, 26vw, 9.5rem)", borderRadius: "50%", margin: "0 auto clamp(1rem, 3vw, 1.25rem)" }} />
        <div className="skeleton" style={{ width: "12rem", height: "clamp(1.5rem, 5vw, 2.25rem)", margin: "0 auto 10px", borderRadius: "6px" }} />
        <div className="skeleton" style={{ width: "7rem", height: "0.8125rem", margin: "0 auto 14px", borderRadius: "4px" }} />
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginBottom: "1.25rem" }}>
          <div className="skeleton" style={{ width: "3.5rem", height: "1.5rem", borderRadius: "9999px" }} />
          <div className="skeleton" style={{ width: "3.5rem", height: "1.5rem", borderRadius: "9999px" }} />
        </div>
        <div style={{ display: "flex", gap: "0.625rem", justifyContent: "center" }}>
          <div className="skeleton" style={{ width: "7rem", height: "2.75rem", borderRadius: "9999px" }} />
          <div className="skeleton" style={{ width: "2.75rem", height: "2.75rem", borderRadius: "9999px" }} />
          <div className="skeleton" style={{ width: "2.75rem", height: "2.75rem", borderRadius: "9999px" }} />
        </div>
      </div>
      <div style={{ padding: "0 clamp(1.25rem, 5vw, 2rem)" }}>
        <div className="skeleton" style={{ width: "4.5rem", height: "0.9375rem", marginBottom: "1rem", borderRadius: "4px" }} />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0" }}>
            <div className="skeleton" style={{ width: "3rem", height: "3rem", borderRadius: "8px", flexShrink: 0 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
              <div className="skeleton" style={{ width: `${50 + ((i * 17) % 30)}%`, height: "0.8125rem", borderRadius: "4px" }} />
              <div className="skeleton" style={{ width: `${25 + ((i * 13) % 20)}%`, height: "0.6875rem", borderRadius: "4px" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
