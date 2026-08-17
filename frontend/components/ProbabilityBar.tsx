// Barra 1X2: três resultados mutuamente exclusivos de UMA partida, cor fixa
// por papel (casa/empate/fora) — não é série categórica arbitrária, mas a
// mesma lógica de "cor por identidade, ordem fixa" se aplica (ver skill dataviz).
type Props = {
  homeLabel: string;
  awayLabel: string;
  homePct: number; // 0-1
  drawPct: number;
  awayPct: number;
};

export function ProbabilityBar({ homeLabel, awayLabel, homePct, drawPct, awayPct }: Props) {
  const h = Math.round(homePct * 100);
  const d = Math.round(drawPct * 100);
  const a = Math.round(awayPct * 100);

  return (
    <div className="prob-bar">
      <div className="prob-bar-track">
        <div className="prob-seg prob-home" style={{ width: `${h}%` }} title={`${homeLabel}: ${h}%`} />
        <div className="prob-seg prob-draw" style={{ width: `${d}%` }} title={`Empate: ${d}%`} />
        <div className="prob-seg prob-away" style={{ width: `${a}%` }} title={`${awayLabel}: ${a}%`} />
      </div>
      <div className="prob-bar-legend">
        <span>
          <i className="dot dot-home" aria-hidden />
          {homeLabel} <b>{h}%</b>
        </span>
        <span>
          <i className="dot dot-draw" aria-hidden />
          Empate <b>{d}%</b>
        </span>
        <span>
          <i className="dot dot-away" aria-hidden />
          {awayLabel} <b>{a}%</b>
        </span>
      </div>
    </div>
  );
}
