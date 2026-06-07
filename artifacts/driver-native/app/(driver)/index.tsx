import { Briefcase } from "lucide-react-native";
import { PlaceholderScreen } from "@/components/PlaceholderScreen";
import { useT } from "@/lib/i18n";

export default function OrdersScreen() {
  const { t } = useT();
  return (
    <PlaceholderScreen
      icon={Briefcase}
      title={t("orders_title")}
      subtitle={t("orders_empty")}
    />
  );
}
