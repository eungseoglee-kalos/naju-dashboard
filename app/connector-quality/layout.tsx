import DashboardGate from "@/components/dashboard/DashboardGate";

export const runtime = "nodejs";

export default function ConnectorQualityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardGate href="/connector-quality">{children}</DashboardGate>;
}
