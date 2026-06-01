import { Chip } from "@mui/joy";

export type PremiumStatus = "UNKNOWN" | "PREMIUM" | "FREE_WITH_ADS" | "PERSONAL_NO_ADS";

interface Props {
  status: PremiumStatus;
}

export function PremiumBadge({ status }: Props) {
  if (status === "UNKNOWN") return null;
  const color =
    status === "PREMIUM" ? "primary" :
    status === "PERSONAL_NO_ADS" ? "primary" :
    "warning";
  const label =
    status === "PREMIUM" ? "Premium（無廣告）" :
    status === "PERSONAL_NO_ADS" ? "個人模式（無廣告）" :
    "免費帳號（將顯示廣告）";
  return (
    <Chip color={color} variant="solid" size="sm">
      {label}
    </Chip>
  );
}
