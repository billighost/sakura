export default function Loading() {
  return (
    <div style={{ padding: "clamp(0.75rem, 3vw, 1.25rem)", display: "flex", flexDirection: "column", gap: "1.25rem" }} className="anim-fade-in">
      {/* Header skeleton */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <div className="skeleton" style={{ width: "8rem", height: "2rem", borderRadius: "8px" }} />
        <div className="skeleton" style={{ width: "2.25rem", height: "2.25rem", borderRadius: "50%" }} />
      </div>
      
      {/* Featured banner skeleton */}
      <div className="skeleton" style={{ width: "100%", height: "10rem", borderRadius: "16px" }} />

      {/* Row skeletons */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {[...Array(5)].map((_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "clamp(0.75rem, 3vw, 1rem)", padding: "0.625rem 0" }}>
            <div className="skeleton" style={{ width: "3.25rem", height: "3.25rem", borderRadius: "10px", flexShrink: 0 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <div className="skeleton" style={{ width: "65%", height: "0.9rem" }} />
              <div className="skeleton" style={{ width: "35%", height: "0.75rem" }} />
            </div>
            <div className="skeleton" style={{ width: "1.5rem", height: "1.5rem", borderRadius: "4px" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
