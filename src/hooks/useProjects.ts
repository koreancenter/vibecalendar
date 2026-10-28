import { useState, useEffect, useCallback, useMemo } from 'react';
import { ProjectItem, ProjectStatus } from '../types';
import { INITIAL_PROJECTS, PROJECT_STATUS_MAP } from '../constants/projects';
import { LEGACY_REAL_NAME_PROJECT_IDS } from '../data/sampleEvents';

const STORAGE_KEY = 'vibe_calendar_projects_v2';
const LEGACY_STORAGE_KEY_V1 = 'vibe_calendar_projects_v1';
const LEGACY_SELECTED_PROJECT_KEY = 'vibe_calendar_selected_project_id';
const SELECTED_PROJECTS_KEY = 'vibe_calendar_selected_project_ids_v2';

function isValidProjectItem(item: unknown): item is ProjectItem {
  if (!item || typeof item !== 'object') return false;
  const p = item as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    p.id.length > 0 &&
    typeof p.name === 'string' &&
    p.name.length > 0 &&
    typeof p.color === 'string' &&
    /^#[0-9a-fA-F]{3,8}$/.test(p.color) &&
    typeof p.status === 'string' &&
    p.status in PROJECT_STATUS_MAP &&
    typeof p.createdAt === 'string'
  );
}

export interface VaultProjectsSyncConfig {
  isEncrypted: boolean;
  initialProjects: ProjectItem[];
  initialSelectedProjectIds: string[];
  onEncryptedProjectsChange: (projects: ProjectItem[], selectedProjectIds: string[]) => void;
}

export const useProjects = (
  showToast?: (msg: string) => void,
  vaultProjectsConfig?: VaultProjectsSyncConfig
) => {
  const [projects, setProjects] = useState<ProjectItem[]>(() => {
    if (vaultProjectsConfig?.isEncrypted) {
      return vaultProjectsConfig.initialProjects.filter(
        (p) => !LEGACY_REAL_NAME_PROJECT_IDS.has(p.id)
      );
    }
    try {
      const savedV2 = localStorage.getItem(STORAGE_KEY);
      if (savedV2 !== null) {
        const parsed = JSON.parse(savedV2);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (item): item is ProjectItem =>
              isValidProjectItem(item) && !LEGACY_REAL_NAME_PROJECT_IDS.has(item.id)
          );
        }
      }
      const savedLegacy = localStorage.getItem(LEGACY_STORAGE_KEY_V1);
      if (savedLegacy !== null) {
        const parsedLegacy = JSON.parse(savedLegacy);
        localStorage.removeItem(LEGACY_STORAGE_KEY_V1);
        if (Array.isArray(parsedLegacy)) {
          return parsedLegacy.filter(
            (item): item is ProjectItem =>
              isValidProjectItem(item) && !LEGACY_REAL_NAME_PROJECT_IDS.has(item.id)
          );
        }
      }
    } catch (e) {
      console.warn('Failed to load projects from storage:', e);
    }
    return INITIAL_PROJECTS;
  });

  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(() => {
    if (vaultProjectsConfig?.isEncrypted) {
      return vaultProjectsConfig.initialSelectedProjectIds;
    }
    try {
      const savedList = localStorage.getItem(SELECTED_PROJECTS_KEY);
      if (savedList) {
        const parsed = JSON.parse(savedList);
        if (Array.isArray(parsed)) {
          return parsed.filter((id): id is string => typeof id === 'string' && id !== 'all');
        }
      }
      const legacy = localStorage.getItem(LEGACY_SELECTED_PROJECT_KEY);
      if (legacy && typeof legacy === 'string' && legacy !== 'all') {
        return [legacy];
      }
    } catch {
      // ignore invalid storage
    }
    return [];
  });

  const [isCompareMode, setIsCompareMode] = useState<boolean>(() => {
    if (vaultProjectsConfig?.isEncrypted) {
      return vaultProjectsConfig.initialSelectedProjectIds.length >= 2;
    }
    try {
      const savedList = localStorage.getItem(SELECTED_PROJECTS_KEY);
      if (savedList) {
        const parsed = JSON.parse(savedList);
        if (Array.isArray(parsed) && parsed.length >= 2) return true;
      }
    } catch {
      // ignore
    }
    return false;
  });

  // 존재하지 않는 프로젝트 ID 자동 정리
  useEffect(() => {
    const validIds = new Set(projects.map((p) => p.id));
    setSelectedProjectIds((prev) => {
      const filtered = prev.filter((id) => validIds.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [projects]);

  useEffect(() => {
    if (vaultProjectsConfig?.isEncrypted) {
      vaultProjectsConfig.onEncryptedProjectsChange(projects, selectedProjectIds);
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
      localStorage.setItem(SELECTED_PROJECTS_KEY, JSON.stringify(selectedProjectIds));
    } catch (e) {
      console.warn('Failed to persist projects:', e);
    }
  }, [projects, selectedProjectIds, vaultProjectsConfig]);

  const selectedProjectId: string | 'all' = useMemo(() => {
    return selectedProjectIds.length === 1 ? selectedProjectIds[0] : 'all';
  }, [selectedProjectIds]);

  const selectedProjects: ProjectItem[] = useMemo(() => {
    if (selectedProjectIds.length === 0) return [];
    const byId = new Map(projects.map((p) => [p.id, p]));
    return selectedProjectIds
      .map((id) => byId.get(id))
      .filter((p): p is ProjectItem => Boolean(p));
  }, [projects, selectedProjectIds]);

  const activeProject = useMemo(() => {
    return selectedProjects.length === 1 ? selectedProjects[0] : null;
  }, [selectedProjects]);

  const setSelectedProjectId = useCallback((id: string | 'all') => {
    if (id === 'all') {
      setSelectedProjectIds([]);
      setIsCompareMode(false);
    } else {
      setSelectedProjectIds([id]);
      setIsCompareMode(false);
    }
  }, []);

  const handleProjectClick = useCallback(
    (id: string, multiModifier = false) => {
      if (isCompareMode || multiModifier) {
        setSelectedProjectIds((prev) => {
          const exists = prev.includes(id);
          const next = exists ? prev.filter((item) => item !== id) : [...prev, id];
          if (multiModifier && next.length >= 2) {
            setIsCompareMode(true);
          }
          return next;
        });
      } else {
        setSelectedProjectIds((prev) => (prev.length === 1 && prev[0] === id ? [] : [id]));
      }
    },
    [isCompareMode]
  );

  const toggleProjectInComparison = useCallback((id: string) => {
    setSelectedProjectIds((prev) => {
      const exists = prev.includes(id);
      const next = exists ? prev.filter((item) => item !== id) : [...prev, id];
      if (next.length >= 2) {
        setIsCompareMode(true);
      } else if (next.length === 0) {
        setIsCompareMode(false);
      }
      return next;
    });
  }, []);

  const toggleCompareMode = useCallback(() => {
    setIsCompareMode((prev) => {
      const nextMode = !prev;
      if (!nextMode) {
        // 비교 모드 해제 시 단일 포커스 또는 전체 보기로 깔끔히 복귀
        setSelectedProjectIds((curr) => (curr.length > 1 ? [] : curr));
      }
      return nextMode;
    });
  }, []);

  const createProject = useCallback(
    (newProjectData: Omit<ProjectItem, 'id' | 'createdAt'>) => {
      const id = `proj-${Date.now()}`;
      const newProject: ProjectItem = {
        ...newProjectData,
        status: (newProjectData.status in PROJECT_STATUS_MAP
          ? newProjectData.status
          : 'active') as ProjectStatus,
        id,
        createdAt: new Date().toISOString(),
      };
      setProjects((prev) => [newProject, ...prev]);
      showToast?.(`새 프로젝트 '${newProject.name}'이(가) 등록되었습니다.`);
      return newProject;
    },
    [showToast]
  );

  const updateProject = useCallback(
    (id: string, updates: Partial<ProjectItem>) => {
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
      showToast?.('프로젝트 정보가 수정되었습니다.');
    },
    [showToast]
  );

  const deleteProject = useCallback(
    (id: string) => {
      const target = projects.find((p) => p.id === id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setSelectedProjectIds((prev) => {
        const next = prev.filter((item) => item !== id);
        if (next.length < 2) {
          setIsCompareMode(false);
        }
        return next;
      });
      showToast?.(`'${target?.name || '프로젝트'}'이(가) 삭제되었습니다.`);
    },
    [projects, showToast]
  );

  return {
    projects,
    setProjects,
    selectedProjectId,
    setSelectedProjectId,
    selectedProjectIds,
    setSelectedProjectIds,
    selectedProjects,
    isCompareMode,
    setIsCompareMode,
    handleProjectClick,
    toggleProjectInComparison,
    toggleCompareMode,
    activeProject,
    createProject,
    updateProject,
    deleteProject,
  };
};
