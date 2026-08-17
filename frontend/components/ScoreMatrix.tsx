// Matriz de placar exato: heatmap sequencial de 1 hue só (azul, claro→escuro
// por magnitude), rótulo direto só nas células mais prováveis (ver skill
// dataviz — sequential = uma cor, ordinal por intensidade; "selective direct
// labels", nunca todo mundo rotulado).
type Props = {
  scores: Record<string, number>; // "golsCasa-golsFora" -> probabilidade (0-1)
  maxGoals?: number;
};

// Passos do ramp sequencial azul (claro -> escuro), da paleta de referência do
// skill dataviz — usado aqui como faixa fixa em vez de opacidade solta, pra
// bater com o método (sequential = 1 hue, degradê por magnitude).
const BLUE_RAMP = [
  "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7",
  "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b",
];

function colorForIntensity(intensity: number): string {
  const idx = Math.min(BLUE_RAMP.length - 1, Math.floor(intensity * BLUE_RAMP.length));
  return BLUE_RAMP[idx];
}

// Acima do step 400 (~índice 6) o fundo fica escuro o bastante pra precisar
// de texto claro.
function textColorForIntensity(intensity: number): string {
  const idx = Math.min(BLUE_RAMP.length - 1, Math.floor(intensity * BLUE_RAMP.length));
  return idx >= 6 ? "#ffffff" : "#0b0b0b";
}

export function ScoreMatrix({ scores, maxGoals = 6 }: Props) {
  const rows = Array.from({ length: maxGoals + 1 }, (_, i) => i);
  const values = Object.values(scores);
  const maxProb = values.length > 0 ? Math.max(...values) : 0.0001;

  const topKeys = new Set(
    Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k),
  );

  return (
    <div className="score-matrix">
      <table>
        <caption>Linhas = gols do mandante · colunas = gols do visitante</caption>
        <thead>
          <tr>
            <th scope="col" aria-hidden />
            {rows.map((y) => (
              <th scope="col" key={y}>
                {y}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x}>
              <th scope="row">{x}</th>
              {rows.map((y) => {
                const key = `${x}-${y}`;
                const p = scores[key] ?? 0;
                const intensity = maxProb > 0 ? p / maxProb : 0;
                const showLabel = topKeys.has(key) && p > 0;
                return (
                  <td
                    key={y}
                    style={{
                      backgroundColor: colorForIntensity(intensity),
                      color: textColorForIntensity(intensity),
                    }}
                    title={`Placar ${x}-${y}: ${(p * 100).toFixed(1)}%`}
                  >
                    {showLabel ? `${(p * 100).toFixed(0)}%` : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
