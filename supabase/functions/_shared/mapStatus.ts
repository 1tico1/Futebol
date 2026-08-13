// Normaliza o status curto da API-Football para o enum usado em matches.status.
export function mapFixtureStatus(shortStatus: string): "scheduled" | "live" | "finished" | "postponed" {
  switch (shortStatus) {
    case "TBD":
    case "NS":
      return "scheduled";
    case "1H":
    case "HT":
    case "2H":
    case "ET":
    case "BT":
    case "P":
    case "LIVE":
      return "live";
    case "FT":
    case "AET":
    case "PEN":
      return "finished";
    case "PST":
    case "CANC":
    case "ABD":
    case "SUSP":
    case "INT":
      return "postponed";
    default:
      return "scheduled";
  }
}
