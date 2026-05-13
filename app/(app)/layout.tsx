import Link from "next/link";
import { BarChart3, BookOpen, CalendarDays, Settings, Tags, Users } from "lucide-react";
import { logout } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/reports", label: "Reports", icon: CalendarDays },
  { href: "/articles", label: "Articles", icon: BookOpen },
  { href: "/sources", label: "Sources", icon: BarChart3 },
  { href: "/authors", label: "Authors", icon: Users },
  { href: "/tags", label: "Tags", icon: Tags },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-border bg-background/72 p-6 backdrop-blur-xl lg:block">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-lg font-black text-primary-foreground">M</div>
          <div>
            <p className="text-lg font-semibold tracking-tight">Matter Stats</p>
            <p className="text-xs text-muted-foreground">Private reading analytics</p>
          </div>
        </Link>
        <nav className="mt-10 space-y-2">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted/70 hover:text-foreground">
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <form action={logout} className="absolute bottom-6 left-6 right-6">
          <Button type="submit" variant="secondary" className="w-full">Log out</Button>
        </form>
      </aside>
      <main className="px-4 py-6 lg:ml-72 lg:px-10 lg:py-10">{children}</main>
    </div>
  );
}
