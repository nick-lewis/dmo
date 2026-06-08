import mainPanelAppRegistryData from "./mainPanelAppRegistry.json";

export type MainPanelAppConfigField = {
  defaultValue?: string | number;
  id: string;
  inputMode?: "text" | "numeric" | "decimal";
  label: string;
  placeholder?: string;
  type?: "text" | "number";
};

export type MainPanelAppMetadata = {
  configFields?: MainPanelAppConfigField[];
  defaultConfig?: Record<string, unknown>;
  defaultView: string;
  id: string;
  label: string;
  views: Array<{ id: string; label: string }>;
};

export const mainPanelAppMetadataDefinitions =
  mainPanelAppRegistryData as MainPanelAppMetadata[];

export function getMainPanelAppMetadata(appId: string) {
  return (
    mainPanelAppMetadataDefinitions.find((app) => app.id === appId) ?? null
  );
}
