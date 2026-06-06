import { Phone, Mail } from "lucide-react";

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-white/70">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <img src="/logo-1313.png" alt="Такси 1313" className="w-8 h-8 rounded-lg object-cover" />
              <span className="text-lg font-bold text-white">Такси 1313</span>
            </div>
            <p className="text-sm leading-relaxed">
              Удобный сервис межгородских поездок по Узбекистану. Безопасно, комфортно, доступно.
            </p>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-4">Маршруты</h3>
            <ul className="space-y-2 text-sm">
              <li>Ташкент — Самарканд</li>
              <li>Ташкент — Бухара</li>
              <li>Ташкент — Фергана</li>
              <li>Самарканд — Бухара</li>
            </ul>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-4">Контакты</h3>
            <ul className="space-y-3 text-sm">
              <li className="flex items-center gap-2">
                <Phone className="w-4 h-4" />
                +998 90 123 45 67
              </li>
              <li className="flex items-center gap-2">
                <Mail className="w-4 h-4" />
                info@buxtaxi.uz
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 mt-10 pt-6 text-center text-sm">
          &copy; {new Date().getFullYear()} Такси 1313. Все права защищены.
        </div>
      </div>
    </footer>
  );
}
