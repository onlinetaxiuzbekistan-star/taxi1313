import { MessageCircle } from "lucide-react-native";
import { PlaceholderScreen } from "@/components/PlaceholderScreen";
import { useT } from "@/lib/i18n";

export default function ChatScreen() {
  const { t } = useT();
  return (
    <PlaceholderScreen
      icon={MessageCircle}
      title={t("chat_title")}
      subtitle={t("phase0_note")}
    />
  );
}
