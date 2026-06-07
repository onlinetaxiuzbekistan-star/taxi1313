import { Zap } from "lucide-react-native";
import { PlaceholderScreen } from "@/components/PlaceholderScreen";
import { useT } from "@/lib/i18n";

export default function UrgentScreen() {
  const { t } = useT();
  return (
    <PlaceholderScreen
      icon={Zap}
      title={t("urgent_title")}
      subtitle={t("phase0_note")}
    />
  );
}
