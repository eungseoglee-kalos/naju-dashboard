import DashboardGate from "@/components/dashboard/DashboardGate";

export const runtime = "nodejs";

export default function ElectronBeamQualityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardGate href="/electron-beam-quality">{children}</DashboardGate>
  );
}
