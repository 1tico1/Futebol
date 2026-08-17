// Status por resultado (vitória/empate/derrota) — usa a paleta de status
// fixa do skill dataviz (good/neutral/critical), sempre com rótulo (W/D/L),
// nunca só a cor.
export type FormResult = {
  id: number;
  result: "W" | "D" | "L";
  opponent?: string | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  isHome: boolean;
};

export function FormBadges({ items }: { items: FormResult[] }) {
  if (items.length === 0) {
    return <p className="form-empty">Sem jogos finalizados recentes.</p>;
  }

  return (
    <div className="form-badges">
      {items.map((m) => (
        <span
          key={m.id}
          className={`form-badge form-${m.result.toLowerCase()}`}
          title={`${m.isHome ? "vs" : "@"} ${m.opponent ?? "?"} (${m.goalsFor ?? "-"}-${m.goalsAgainst ?? "-"})`}
        >
          {m.result}
        </span>
      ))}
    </div>
  );
}
