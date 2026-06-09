import { useState } from "react";

import { apiFetch } from "../api";
import type { ImageLibraryOption } from "./ImageLibraryPicker";

type UseScriptImageLibraryOptions = {
  experienceId: string;
  setError: (message: string) => void;
};

export function useScriptImageLibrary({
  experienceId,
  setError,
}: UseScriptImageLibraryOptions) {
  const [scriptImageOptions, setScriptImageOptions] = useState<
    ImageLibraryOption[]
  >([]);
  const [deletingScriptImagePath, setDeletingScriptImagePath] = useState("");
  const [isLoadingScriptImages, setIsLoadingScriptImages] = useState(false);

  async function loadScriptImages(targetExperienceId = experienceId) {
    if (!targetExperienceId) return;

    setIsLoadingScriptImages(true);
    try {
      const payload = await apiFetch<{ images: ImageLibraryOption[] }>(
        `/api/experiences/${encodeURIComponent(targetExperienceId)}/script-images/`,
      );
      setScriptImageOptions(payload.images);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load script images.",
      );
    } finally {
      setIsLoadingScriptImages(false);
    }
  }

  async function uploadScriptImageFile(
    file: File,
    fallbackErrorMessage: string,
  ): Promise<string | null> {
    if (!experienceId) return null;

    try {
      const formData = new FormData();
      formData.append("image", file);
      const payload = await apiFetch<{
        imagePath: string;
        images: ImageLibraryOption[];
      }>(`/api/experiences/${encodeURIComponent(experienceId)}/script-images/`, {
        method: "POST",
        body: formData,
      });

      setScriptImageOptions(payload.images);
      return payload.imagePath;
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : fallbackErrorMessage,
      );
      return null;
    }
  }

  async function deleteScriptImageFile(imagePath: string): Promise<boolean> {
    if (!experienceId || !imagePath) return false;

    setDeletingScriptImagePath(imagePath);
    try {
      const payload = await apiFetch<{
        deletedImagePath: string;
        images: ImageLibraryOption[];
      }>(`/api/experiences/${encodeURIComponent(experienceId)}/script-images/`, {
        method: "DELETE",
        body: JSON.stringify({ imagePath }),
      });

      setScriptImageOptions(payload.images);
      return true;
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete script image.",
      );
      return false;
    } finally {
      setDeletingScriptImagePath((current) =>
        current === imagePath ? "" : current,
      );
    }
  }

  return {
    deleteScriptImageFile,
    deletingScriptImagePath,
    isLoadingScriptImages,
    loadScriptImages,
    scriptImageOptions,
    uploadScriptImageFile,
  };
}
