import type {
  ChangeEvent,
  CSSProperties,
  DragEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type CurrentView = 'dashboard' | 'library' | 'planner' | 'note' | 'insights'

type DocumentItem = {
  id?: string
  area: string
  title: string
  subject: string
  type: string
  meta: string
  tags: string[]
  link?: string
}

type PendingUploadItem = {
  key: string
  file: File
  displayName: string
}

type SubjectDefinition = {
  area: string
  name: string
}

type PlannerSession = {
  id: string
  area?: string
  subject: string
  note: string
  startMinutes: number
  endMinutes: number
  sessionDate?: string
  outcome?: 'completed' | 'abandoned'
  focusScore?: number
  reviewedAt?: string
  sheetsSyncStatus?: 'pending' | 'syncing' | 'synced' | 'failed'
  sheetsSyncedAt?: string
}

type PlannerSelectionStage = 'start' | 'end'

type TokenResponse = {
  access_token?: string
  error?: string
}

type TokenClient = {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void
}

type TokenErrorResponse = {
  type?: string
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (response: TokenResponse) => void
            error_callback?: (error: TokenErrorResponse) => void
          }) => TokenClient
        }
      }
    }
  }
}

const GOOGLE_CLIENT_ID =
  '347804918623-t28vi7icqkvqr7f8geloto0ncogj13up.apps.googleusercontent.com'
const GOOGLE_SCOPES =
  'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets'
const GOOGLE_SHEETS_SPREADSHEET_ID = '1YgnlfTvrEJC2Y0vTL5zI95yii6LBbhAXeWeVxTpNyP0'
const GOOGLE_SHEETS_TAB_NAME = 'Sessions'
const DRIVE_FOLDER_NAME = 'StudieRommet'
const DRIVE_AUTO_CONNECT_KEY = 'studierommet-drive-auto-connect'
const AREAS_STORAGE_KEY = 'studierommet-areas'
const SUBJECTS_STORAGE_KEY = 'studierommet-subjects'
const SUBJECT_DEFINITIONS_STORAGE_KEY = 'studierommet-subject-definitions'
const PLANNER_SESSIONS_STORAGE_KEY = 'studierommet-planner-sessions'
const PLANNER_START_HOUR = 6
const PLANNER_END_HOUR = 22
const PLANNER_STEP_MINUTES = 5
const DAILY_TREE_GOAL_MINUTES = 7 * 60
const DEFAULT_AREA_NAME = 'Uni'
const DEFAULT_AREA_NAMES = [DEFAULT_AREA_NAME, 'Business'] as const
const ALL_AREAS_FILTER = 'All'

const navItems: Array<{ label: string; view?: CurrentView }> = [
  { label: 'Dashboard', view: 'dashboard' },
  { label: 'Library', view: 'library' },
  { label: 'Planner', view: 'planner' },
  { label: 'Sessions' },
  { label: 'Insights', view: 'insights' },
]
const filters = ['All', 'Notes', 'Lectures', 'Assignments', 'Readings']
const areaToneFamilies = [
  {
    pillBackground: 'rgba(111, 29, 58, 0.1)',
    pillBorder: 'rgba(111, 29, 58, 0.16)',
    pillText: '#6f1d3a',
    sessionVariants: [
      { background: 'rgba(111, 29, 58, 0.12)', border: 'rgba(111, 29, 58, 0.34)' },
      { background: 'rgba(151, 56, 89, 0.12)', border: 'rgba(151, 56, 89, 0.34)' },
      { background: 'rgba(183, 91, 120, 0.14)', border: 'rgba(183, 91, 120, 0.34)' },
    ],
  },
  {
    pillBackground: 'rgba(104, 86, 78, 0.1)',
    pillBorder: 'rgba(104, 86, 78, 0.16)',
    pillText: '#68564e',
    sessionVariants: [
      { background: 'rgba(104, 86, 78, 0.12)', border: 'rgba(104, 86, 78, 0.32)' },
      { background: 'rgba(137, 113, 101, 0.13)', border: 'rgba(137, 113, 101, 0.32)' },
      { background: 'rgba(167, 141, 126, 0.14)', border: 'rgba(167, 141, 126, 0.34)' },
    ],
  },
  {
    pillBackground: 'rgba(64, 108, 138, 0.1)',
    pillBorder: 'rgba(64, 108, 138, 0.16)',
    pillText: '#406c8a',
    sessionVariants: [
      { background: 'rgba(64, 108, 138, 0.12)', border: 'rgba(64, 108, 138, 0.32)' },
      { background: 'rgba(88, 132, 162, 0.13)', border: 'rgba(88, 132, 162, 0.34)' },
      { background: 'rgba(117, 153, 177, 0.14)', border: 'rgba(117, 153, 177, 0.34)' },
    ],
  },
  {
    pillBackground: 'rgba(51, 118, 89, 0.1)',
    pillBorder: 'rgba(51, 118, 89, 0.16)',
    pillText: '#337659',
    sessionVariants: [
      { background: 'rgba(51, 118, 89, 0.12)', border: 'rgba(51, 118, 89, 0.32)' },
      { background: 'rgba(76, 142, 112, 0.13)', border: 'rgba(76, 142, 112, 0.34)' },
      { background: 'rgba(108, 168, 137, 0.14)', border: 'rgba(108, 168, 137, 0.34)' },
    ],
  },
] as const

const typeIndicatorMap: Record<string, { symbol: string; label: string }> = {
  notes: { symbol: '✎', label: 'Notes' },
  note: { symbol: '✎', label: 'Notes' },
  lecture: { symbol: '◉', label: 'Lecture' },
  lectures: { symbol: '◉', label: 'Lecture' },
  reading: { symbol: '◫', label: 'Reading' },
  readings: { symbol: '◫', label: 'Reading' },
  assignment: { symbol: '✓', label: 'Assignment' },
  assignments: { symbol: '✓', label: 'Assignment' },
}

function getNow() {
  return new Date()
}

function normalizeLabel(value: string) {
  return value.trim()
}

function getSubjectFocusValue(value: string) {
  const normalizedValue = normalizeLabel(value)

  if (normalizedValue.toLowerCase() === 'unsorted') {
    return ''
  }

  return normalizedValue
}

function hashValue(value: string) {
  return Array.from(value).reduce((total, character) => total + character.charCodeAt(0), 0)
}

function sortAreaNames(areaNames: string[]) {
  const normalized = Array.from(
    new Set(areaNames.map(normalizeLabel).filter(Boolean)),
  )

  const defaults = DEFAULT_AREA_NAMES.filter((area) => normalized.includes(area))
  const customAreas = normalized
    .filter((area) => !DEFAULT_AREA_NAMES.includes(area as (typeof DEFAULT_AREA_NAMES)[number]))
    .sort((left, right) => left.localeCompare(right))

  return [...defaults, ...customAreas]
}

function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')

  return `${year}-${month}-${day}`
}

function createDateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)

  if (!year || !month || !day) {
    return new Date()
  }

  return new Date(year, month - 1, day)
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + days)
  return nextDate
}

function getStartOfWeek(date: Date) {
  const startOfWeek = new Date(date)
  const dayOffset = (startOfWeek.getDay() + 6) % 7
  startOfWeek.setHours(0, 0, 0, 0)
  startOfWeek.setDate(startOfWeek.getDate() - dayOffset)
  return startOfWeek
}

function formatDuration(minutes: number) {
  if (minutes <= 0) {
    return '0m'
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  if (hours === 0) {
    return `${remainingMinutes}m`
  }

  if (remainingMinutes === 0) {
    return `${hours}h`
  }

  return `${hours}h ${remainingMinutes}m`
}

function formatMetricDelta(value: number, suffix = '') {
  if (value === 0) {
    return `0${suffix}`
  }

  return `${value > 0 ? '+' : ''}${value}${suffix}`
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`
}

function getAverage(values: number[]) {
  if (values.length === 0) {
    return null
  }

  return values.reduce((total, value) => total + value, 0) / values.length
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getProgressReveal(progress: number, start: number, end = start + 0.18) {
  return clamp((progress - start) / (end - start), 0, 1)
}

function getPlannerSessionDateKey(session: PlannerSession, fallbackDateKey: string) {
  return session.sessionDate ?? fallbackDateKey
}

function getPlannerSessionArea(session: PlannerSession) {
  return normalizeLabel(session.area ?? '') || DEFAULT_AREA_NAME
}

function getPlannerSessionTitle(session: PlannerSession) {
  return (
    getSubjectFocusValue(session.subject) ||
    normalizeLabel(session.note) ||
    'Session'
  )
}

function isPlannerSessionReadyForReview(
  session: PlannerSession,
  todayDateKey: string,
  nowInMinutes: number,
) {
  const sessionDateKey = getPlannerSessionDateKey(session, todayDateKey)

  return (
    session.outcome === undefined &&
    (sessionDateKey < todayDateKey ||
      (sessionDateKey === todayDateKey && nowInMinutes >= session.endMinutes))
  )
}

function formatSheetDateTime(dateKey: string, totalMinutes: number) {
  return `${dateKey} ${formatTimelineTime(totalMinutes)}`
}

function parseTags(tagValue: string) {
  return tagValue
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function mergeAreas(currentAreas: string[], incomingAreas: string[]) {
  return sortAreaNames([...currentAreas, ...incomingAreas])
}

function mergeSubjectDefinitions(
  currentDefinitions: SubjectDefinition[],
  incomingDefinitions: SubjectDefinition[],
) {
  const uniqueDefinitions = new Map<string, SubjectDefinition>()

  for (const definition of [...currentDefinitions, ...incomingDefinitions]) {
    const area = normalizeLabel(definition.area)
    const name = normalizeLabel(definition.name)

    if (!area || !name) {
      continue
    }

    uniqueDefinitions.set(`${area.toLowerCase()}::${name.toLowerCase()}`, { area, name })
  }

  return Array.from(uniqueDefinitions.values()).sort((left, right) => {
    if (left.area !== right.area) {
      return left.area.localeCompare(right.area)
    }

    return left.name.localeCompare(right.name)
  })
}

function getSubjectArea(subjectDefinitions: SubjectDefinition[], subjectName: string) {
  const normalizedSubject = getSubjectFocusValue(subjectName).toLowerCase()

  if (!normalizedSubject) {
    return DEFAULT_AREA_NAME
  }

  return (
    subjectDefinitions.find(
      (definition) => definition.name.toLowerCase() === normalizedSubject,
    )?.area ?? DEFAULT_AREA_NAME
  )
}

function getSubjectSuggestions(
  subjectDefinitions: SubjectDefinition[],
  areaName: string,
) {
  const normalizedArea = normalizeLabel(areaName)

  return subjectDefinitions
    .filter((definition) =>
      normalizedArea ? definition.area === normalizedArea : true,
    )
    .map((definition) => definition.name)
    .sort((left, right) => left.localeCompare(right))
}

function loadStoredAreas() {
  const storedAreas = localStorage.getItem(AREAS_STORAGE_KEY)

  if (!storedAreas) {
    return [...DEFAULT_AREA_NAMES]
  }

  try {
    const parsedAreas = JSON.parse(storedAreas) as unknown

    if (Array.isArray(parsedAreas)) {
      return mergeAreas(
        [...DEFAULT_AREA_NAMES],
        parsedAreas.filter((area): area is string => typeof area === 'string'),
      )
    }
  } catch {
    localStorage.removeItem(AREAS_STORAGE_KEY)
  }

  return [...DEFAULT_AREA_NAMES]
}

function loadStoredSubjectDefinitions() {
  const storedDefinitions = localStorage.getItem(SUBJECT_DEFINITIONS_STORAGE_KEY)

  if (storedDefinitions) {
    try {
      const parsedDefinitions = JSON.parse(storedDefinitions) as unknown

      if (Array.isArray(parsedDefinitions)) {
        return mergeSubjectDefinitions(
          [],
          parsedDefinitions.filter(
            (definition): definition is SubjectDefinition =>
              typeof definition === 'object' &&
              definition !== null &&
              typeof (definition as SubjectDefinition).area === 'string' &&
              typeof (definition as SubjectDefinition).name === 'string',
          ),
        )
      }
    } catch {
      localStorage.removeItem(SUBJECT_DEFINITIONS_STORAGE_KEY)
    }
  }

  const storedSubjects = localStorage.getItem(SUBJECTS_STORAGE_KEY)

  if (!storedSubjects) {
    return []
  }

  try {
    const parsedSubjects = JSON.parse(storedSubjects) as unknown

    if (Array.isArray(parsedSubjects)) {
      return mergeSubjectDefinitions(
        [],
        parsedSubjects
          .filter((subject): subject is string => typeof subject === 'string')
          .map((subject) => ({ area: DEFAULT_AREA_NAME, name: subject })),
      )
    }
  } catch {
    localStorage.removeItem(SUBJECTS_STORAGE_KEY)
  }

  return []
}

function loadStoredPlannerSessions() {
  const storedSessions = localStorage.getItem(PLANNER_SESSIONS_STORAGE_KEY)

  if (!storedSessions) {
    return []
  }

  try {
    const parsedSessions = JSON.parse(storedSessions) as unknown

    if (Array.isArray(parsedSessions)) {
      return parsedSessions
        .filter((session): session is PlannerSession => {
          if (typeof session !== 'object' || session === null) {
            return false
          }

          const candidate = session as Partial<PlannerSession>

          return (
            typeof candidate.id === 'string' &&
            (candidate.area === undefined || typeof candidate.area === 'string') &&
            typeof candidate.subject === 'string' &&
            typeof candidate.note === 'string' &&
            typeof candidate.startMinutes === 'number' &&
            typeof candidate.endMinutes === 'number' &&
            (candidate.sessionDate === undefined || typeof candidate.sessionDate === 'string') &&
            (candidate.outcome === undefined ||
              candidate.outcome === 'completed' ||
              candidate.outcome === 'abandoned') &&
            (candidate.focusScore === undefined ||
              (typeof candidate.focusScore === 'number' &&
                candidate.focusScore >= 1 &&
                candidate.focusScore <= 10)) &&
            (candidate.reviewedAt === undefined || typeof candidate.reviewedAt === 'string') &&
            (candidate.sheetsSyncStatus === undefined ||
              candidate.sheetsSyncStatus === 'pending' ||
              candidate.sheetsSyncStatus === 'syncing' ||
              candidate.sheetsSyncStatus === 'synced' ||
              candidate.sheetsSyncStatus === 'failed') &&
            (candidate.sheetsSyncedAt === undefined ||
              typeof candidate.sheetsSyncedAt === 'string')
          )
        })
        .sort((left, right) => {
          const leftDate = left.sessionDate ?? ''
          const rightDate = right.sessionDate ?? ''

          if (leftDate !== rightDate) {
            return leftDate.localeCompare(rightDate)
          }

          return left.startMinutes - right.startMinutes
        })
    }
  } catch {
    localStorage.removeItem(PLANNER_SESSIONS_STORAGE_KEY)
  }

  return []
}

function createPendingUploadKey(file: File) {
  return `${file.name}-${file.lastModified}-${file.size}`
}

function createPendingUploadItems(files: File[]) {
  return files.map((file) => ({
    key: createPendingUploadKey(file),
    file,
    displayName: file.name,
  }))
}

function getAreaFamilyIndex(areaName: string) {
  const normalizedArea = normalizeLabel(areaName).toLowerCase()

  if (normalizedArea === 'uni') {
    return 0
  }

  if (normalizedArea === 'business') {
    return 1
  }

  return hashValue(normalizedArea || DEFAULT_AREA_NAME.toLowerCase()) % areaToneFamilies.length
}

function getAreaTone(areaName: string) {
  const family = areaToneFamilies[getAreaFamilyIndex(areaName)]

  return {
    background: family.pillBackground,
    border: family.pillBorder,
    text: family.pillText,
  }
}

function getSubjectTone(areaName: string, subjectName: string) {
  const family = areaToneFamilies[getAreaFamilyIndex(areaName)]
  const normalizedSubject = getSubjectFocusValue(subjectName).toLowerCase()

  if (!normalizedSubject) {
    return family.sessionVariants[0]
  }

  return family.sessionVariants[hashValue(normalizedSubject) % family.sessionVariants.length]
}

function getTypeIndicator(type: string) {
  return typeIndicatorMap[type.trim().toLowerCase()] ?? {
    symbol: '•',
    label: type.trim() || 'File',
  }
}

function formatTimelineTime(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(2024, 0, 1, hours, minutes))
}

function hasPlannerOverlap(
  sessions: PlannerSession[],
  startMinutes: number,
  endMinutes: number,
) {
  return sessions.some(
    (session) =>
      startMinutes < session.endMinutes && endMinutes > session.startMinutes,
  )
}

async function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-google-identity="true"]',
    )

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true })
      existingScript.addEventListener(
        'error',
        () => reject(new Error('Failed to load Google Identity Services.')),
        { once: true },
      )
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.googleIdentity = 'true'
    script.onload = () => resolve()
    script.onerror = () =>
      reject(new Error('Failed to load Google Identity Services.'))
    document.head.append(script)
  })
}

async function driveRequest<T>(
  accessToken: string,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || 'Google Drive request failed.')
  }

  return (await response.json()) as T
}

async function ensureDriveFolder(accessToken: string) {
  const cachedFolderId = localStorage.getItem('studierommet-drive-folder-id')

  if (cachedFolderId) {
    return cachedFolderId
  }

  const query = encodeURIComponent(
    `mimeType = 'application/vnd.google-apps.folder' and name = '${DRIVE_FOLDER_NAME}' and trashed = false`,
  )

  const searchResult = await driveRequest<{
    files: Array<{ id: string }>
  }>(
    accessToken,
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)&spaces=drive`,
  )

  if (searchResult.files.length > 0) {
    const folderId = searchResult.files[0].id
    localStorage.setItem('studierommet-drive-folder-id', folderId)
    return folderId
  }

  const createdFolder = await driveRequest<{ id: string }>(
    accessToken,
    'https://www.googleapis.com/drive/v3/files',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: DRIVE_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    },
  )

  localStorage.setItem('studierommet-drive-folder-id', createdFolder.id)
  return createdFolder.id
}

async function uploadFileToDrive(
  accessToken: string,
  file: File,
  folderId: string,
  area: string,
  subject: string,
  type: string,
  tags: string[],
  displayName: string,
) {
  const formData = new FormData()

  formData.append(
    'metadata',
    new Blob(
      [
        JSON.stringify({
          name: file.name,
          parents: [folderId],
          appProperties: {
            area,
            subject,
            type,
            tags: tags.join(', '),
            displayName,
          },
        }),
      ],
      { type: 'application/json' },
    ),
  )
  formData.append('file', file)

  return await driveRequest<{
    id: string
    name: string
    webViewLink: string
  }>(
    accessToken,
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      body: formData,
    },
  )
}

async function deleteFileFromDrive(accessToken: string, fileId: string) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || 'Google Drive delete failed.')
  }
}

async function appendPlannerSessionToSheet(
  accessToken: string,
  session: PlannerSession,
  fallbackDateKey: string,
) {
  const sessionDateKey = getPlannerSessionDateKey(session, fallbackDateKey)
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_SPREADSHEET_ID}/values/${encodeURIComponent(`${GOOGLE_SHEETS_TAB_NAME}!A:I`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [
          [
            sessionDateKey,
            session.subject,
            session.note,
            formatSheetDateTime(sessionDateKey, session.startMinutes),
            formatSheetDateTime(sessionDateKey, session.endMinutes),
            session.endMinutes - session.startMinutes,
            session.outcome ?? '',
            session.focusScore ?? '',
            session.reviewedAt ?? new Date().toISOString(),
          ],
        ],
      }),
    },
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || 'Google Sheets request failed.')
  }

  return (await response.json()) as { updates?: { updatedRows?: number } }
}

function formatDriveMeta(createdTime?: string) {
  if (!createdTime) {
    return 'Saved in Google Drive'
  }

  return `Uploaded ${new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  }).format(new Date(createdTime))}`
}

const treeLeafNodes = [
  { cx: 114, cy: 154, r: 24, start: 0.12 },
  { cx: 146, cy: 134, r: 28, start: 0.16 },
  { cx: 184, cy: 128, r: 30, start: 0.2 },
  { cx: 218, cy: 148, r: 24, start: 0.24 },
  { cx: 104, cy: 198, r: 26, start: 0.28 },
  { cx: 142, cy: 182, r: 32, start: 0.32 },
  { cx: 182, cy: 176, r: 34, start: 0.36 },
  { cx: 222, cy: 194, r: 28, start: 0.4 },
  { cx: 132, cy: 224, r: 30, start: 0.44 },
  { cx: 170, cy: 220, r: 36, start: 0.48 },
  { cx: 210, cy: 226, r: 30, start: 0.52 },
  { cx: 158, cy: 102, r: 18, start: 0.56 },
  { cx: 202, cy: 104, r: 20, start: 0.6 },
  { cx: 96, cy: 166, r: 16, start: 0.64 },
  { cx: 238, cy: 172, r: 16, start: 0.68 },
  { cx: 120, cy: 116, r: 14, start: 0.72 },
  { cx: 228, cy: 120, r: 14, start: 0.76 },
  { cx: 170, cy: 84, r: 14, start: 0.8 },
] as const

const treeFruitNodes = [
  { cx: 140, cy: 170, start: 0.72 },
  { cx: 190, cy: 160, start: 0.78 },
  { cx: 124, cy: 212, start: 0.84 },
  { cx: 210, cy: 206, start: 0.9 },
  { cx: 171, cy: 118, start: 0.96 },
] as const

function DailyGrowthTree({ progress }: { progress: number }) {
  const treeProgress = clamp(progress, 0, 1)
  const trunkReveal = getProgressReveal(treeProgress, 0, 0.38)
  const branchReveal = getProgressReveal(treeProgress, 0.2, 0.62)
  const canopyReveal = getProgressReveal(treeProgress, 0.28, 0.9)
  const auraReveal = getProgressReveal(treeProgress, 0.7, 1)
  const trunkTopY = 292 - trunkReveal * 118
  const trunkWidth = 18 + trunkReveal * 14

  return (
    <svg
      className="daily-tree"
      viewBox="0 0 340 380"
      role="img"
      aria-label={`Daily study tree at ${Math.round(treeProgress * 100)} percent growth`}
    >
      <defs>
        <linearGradient id="tree-sky" x1="0%" x2="0%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 247, 244, 0.98)" />
          <stop offset="100%" stopColor="rgba(246, 236, 231, 0.92)" />
        </linearGradient>
        <linearGradient id="tree-ground" x1="0%" x2="0%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(104, 86, 78, 0.22)" />
          <stop offset="100%" stopColor="rgba(104, 86, 78, 0.08)" />
        </linearGradient>
        <linearGradient id="tree-trunk" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="#7a5849" />
          <stop offset="100%" stopColor="#4b362f" />
        </linearGradient>
        <linearGradient id="tree-leaf" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="#9f486a" />
          <stop offset="55%" stopColor="#7f2d4c" />
          <stop offset="100%" stopColor="#5f1834" />
        </linearGradient>
        <linearGradient id="tree-leaf-soft" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="#c57893" />
          <stop offset="100%" stopColor="#99516f" />
        </linearGradient>
      </defs>

      <rect width="340" height="380" rx="28" fill="url(#tree-sky)" />
      <ellipse
        cx="170"
        cy="310"
        rx={96 + auraReveal * 18}
        ry={26 + auraReveal * 10}
        fill={`rgba(111, 29, 58, ${0.05 + auraReveal * 0.1})`}
      />
      <path
        d="M38 304C86 268 132 276 170 300C214 328 264 324 314 294V380H38Z"
        fill="url(#tree-ground)"
      />
      <circle
        cx="90"
        cy="82"
        r={18 + auraReveal * 10}
        fill={`rgba(255, 226, 198, ${0.22 + auraReveal * 0.16})`}
      />

      <g opacity={0.22 + treeProgress * 0.5}>
        {[74, 112, 248, 272].map((x, index) => (
          <circle
            key={x}
            cx={x}
            cy={64 + index * 16}
            r={2 + index * 0.4}
            fill="rgba(111, 29, 58, 0.28)"
          />
        ))}
      </g>

      <g>
        <path
          d={`M170 306C${170 - trunkWidth} 275 ${168 - trunkWidth * 0.55} ${240 - trunkReveal * 34} ${168 - trunkWidth * 0.35} ${trunkTopY}C170 ${trunkTopY - 8} ${172 + trunkWidth * 0.45} ${238 - trunkReveal * 30} ${170 + trunkWidth} 306Z`}
          fill="url(#tree-trunk)"
        />
        <path
          d={`M170 ${206 - trunkReveal * 28}C147 ${194 - branchReveal * 10} 129 ${178 - branchReveal * 18} 116 ${156 - branchReveal * 26}`}
          stroke="#5e4539"
          strokeLinecap="round"
          strokeWidth={6 + branchReveal * 4}
          fill="none"
          opacity={branchReveal}
        />
        <path
          d={`M171 ${196 - trunkReveal * 24}C193 ${186 - branchReveal * 8} 212 ${170 - branchReveal * 16} 228 ${146 - branchReveal * 24}`}
          stroke="#5e4539"
          strokeLinecap="round"
          strokeWidth={5 + branchReveal * 4}
          fill="none"
          opacity={branchReveal}
        />
        <path
          d={`M166 ${230 - trunkReveal * 24}C144 ${222 - branchReveal * 8} 126 ${210 - branchReveal * 12} 112 ${190 - branchReveal * 16}`}
          stroke="#6e5142"
          strokeLinecap="round"
          strokeWidth={4 + branchReveal * 3}
          fill="none"
          opacity={branchReveal * 0.9}
        />
        <path
          d={`M176 ${226 - trunkReveal * 18}C196 ${220 - branchReveal * 8} 212 ${208 - branchReveal * 14} 224 ${192 - branchReveal * 18}`}
          stroke="#6e5142"
          strokeLinecap="round"
          strokeWidth={4 + branchReveal * 3}
          fill="none"
          opacity={branchReveal * 0.88}
        />
      </g>

      <g>
        {treeLeafNodes.map((leaf, index) => {
          const reveal = getProgressReveal(canopyReveal, leaf.start * 0.7, leaf.start * 0.7 + 0.16)
          const scale = 0.45 + reveal * 0.55
          const fill = index % 3 === 0 ? 'url(#tree-leaf-soft)' : 'url(#tree-leaf)'

          return (
            <circle
              key={`${leaf.cx}-${leaf.cy}`}
              cx={leaf.cx}
              cy={leaf.cy}
              r={leaf.r * scale}
              fill={fill}
              opacity={reveal}
            />
          )
        })}
      </g>

      <g opacity={0.08 + auraReveal * 0.28}>
        <ellipse cx="170" cy="182" rx={98 + canopyReveal * 18} ry={78 + canopyReveal * 18} fill="rgba(111, 29, 58, 0.2)" />
      </g>

      <g>
        {treeFruitNodes.map((fruit, index) => {
          const reveal = getProgressReveal(treeProgress, fruit.start, fruit.start + 0.08)

          return (
            <g key={`${fruit.cx}-${fruit.start}`} opacity={reveal}>
              <path
                d={`M${fruit.cx} ${fruit.cy - 8}C${fruit.cx + 2} ${fruit.cy - 14} ${fruit.cx + 6} ${fruit.cy - 18} ${fruit.cx + 10} ${fruit.cy - 20}`}
                stroke="#6e5142"
                strokeWidth="2"
                fill="none"
              />
              <circle
                cx={fruit.cx}
                cy={fruit.cy}
                r={5 + index * 0.25}
                fill={index % 2 === 0 ? '#f0bc7d' : '#f4a66a'}
              />
            </g>
          )
        })}
      </g>

      <g opacity={0.35 + treeProgress * 0.3}>
        {Array.from({ length: 10 }, (_, index) => (
          <path
            key={index}
            d={`M${74 + index * 22} 308C${76 + index * 22} 300 ${80 + index * 22} 296 ${84 + index * 22} 292`}
            stroke="rgba(80, 122, 98, 0.55)"
            strokeLinecap="round"
            strokeWidth="2"
          />
        ))}
      </g>
    </svg>
  )
}

function App() {
  const [now, setNow] = useState(getNow)
  const [currentView, setCurrentView] = useState<CurrentView>('dashboard')
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [areas, setAreas] = useState<string[]>(loadStoredAreas)
  const [subjectDefinitions, setSubjectDefinitions] = useState<SubjectDefinition[]>(
    loadStoredSubjectDefinitions,
  )
  const [uploadAreaInput, setUploadAreaInput] = useState(DEFAULT_AREA_NAME)
  const [uploadSubjectInput, setUploadSubjectInput] = useState('')
  const [selectedType, setSelectedType] = useState('Notes')
  const [tagValue, setTagValue] = useState('')
  const [pendingUploads, setPendingUploads] = useState<PendingUploadItem[]>([])
  const [noteAreaInput, setNoteAreaInput] = useState(DEFAULT_AREA_NAME)
  const [noteSubjectInput, setNoteSubjectInput] = useState('')
  const [plannerSessions, setPlannerSessions] = useState<PlannerSession[]>(loadStoredPlannerSessions)
  const [isPlannerSetupOpen, setIsPlannerSetupOpen] = useState(false)
  const [plannerAreaInput, setPlannerAreaInput] = useState(DEFAULT_AREA_NAME)
  const [plannerSubjectInput, setPlannerSubjectInput] = useState('')
  const [plannerNoteInput, setPlannerNoteInput] = useState('')
  const [plannerPendingArea, setPlannerPendingArea] = useState(DEFAULT_AREA_NAME)
  const [plannerPendingSubject, setPlannerPendingSubject] = useState('')
  const [plannerPendingNote, setPlannerPendingNote] = useState('')
  const [plannerSetupError, setPlannerSetupError] = useState('')
  const [isPlannerSelecting, setIsPlannerSelecting] = useState(false)
  const [plannerSelectionStage, setPlannerSelectionStage] =
    useState<PlannerSelectionStage>('start')
  const [plannerSelectionStartMinutes, setPlannerSelectionStartMinutes] =
    useState<number | null>(null)
  const [plannerPreviewMinutes, setPlannerPreviewMinutes] = useState<number | null>(null)
  const [plannerSelectionMessage, setPlannerSelectionMessage] = useState('')
  const [plannerReviewOutcome, setPlannerReviewOutcome] = useState<
    'completed' | 'abandoned' | ''
  >('')
  const [plannerReviewFocusScore, setPlannerReviewFocusScore] = useState(8)
  const [plannerReviewError, setPlannerReviewError] = useState('')
  const [activeLibraryAreaFilter, setActiveLibraryAreaFilter] = useState(ALL_AREAS_FILTER)
  const [activePlannerAreaFilter, setActivePlannerAreaFilter] = useState(ALL_AREAS_FILTER)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState(
    'Connect Google Drive to upload files across devices.',
  )
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragActive, setIsDragActive] = useState(false)

  const tokenClientRef = useRef<TokenClient | null>(null)
  const accessTokenRef = useRef<string | null>(null)
  const subjectDefinitionsRef = useRef<SubjectDefinition[]>(subjectDefinitions)
  const pendingUploadsRef = useRef<PendingUploadItem[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const plannerTrackRef = useRef<HTMLDivElement>(null)
  const plannerPointerDownRef = useRef(false)
  const plannerSyncingSessionIdsRef = useRef<Set<string>>(new Set())
  const plannerReviewSubmitLockRef = useRef(false)
  const previousTodayDateKeyRef = useRef(formatDateKey(now))
  const authModeRef = useRef<'manual' | 'auto'>('manual')
  const authTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    accessTokenRef.current = accessToken
  }, [accessToken])

  useEffect(() => {
    subjectDefinitionsRef.current = subjectDefinitions
  }, [subjectDefinitions])

  useEffect(() => {
    localStorage.setItem(AREAS_STORAGE_KEY, JSON.stringify(areas))
  }, [areas])

  useEffect(() => {
    localStorage.setItem(
      SUBJECT_DEFINITIONS_STORAGE_KEY,
      JSON.stringify(subjectDefinitions),
    )
  }, [subjectDefinitions])

  useEffect(() => {
    localStorage.setItem(PLANNER_SESSIONS_STORAGE_KEY, JSON.stringify(plannerSessions))
  }, [plannerSessions])

  useEffect(() => {
    const scheduleUpdate = () => {
      const current = new Date()
      const delay =
        (60 - current.getSeconds()) * 1000 - current.getMilliseconds()

      return window.setTimeout(() => {
        setNow(new Date())
        timeoutId = scheduleUpdate()
      }, delay)
    }

    let timeoutId = scheduleUpdate()

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [])

  const formattedTime = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(now),
    [now],
  )

  const todayDateKey = useMemo(() => formatDateKey(now), [now])
  const [selectedPlannerDateKey, setSelectedPlannerDateKey] = useState(todayDateKey)
  const selectedPlannerDate = useMemo(
    () => createDateFromKey(selectedPlannerDateKey),
    [selectedPlannerDateKey],
  )
  const formattedPlannerDate = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(selectedPlannerDate),
    [selectedPlannerDate],
  )
  const nowInMinutes = useMemo(() => now.getHours() * 60 + now.getMinutes(), [now])
  const isViewingToday = selectedPlannerDateKey === todayDateKey
  const areaFilterOptions = useMemo(
    () =>
      sortAreaNames([
        ...areas,
        ...documents.map((document) => document.area),
        ...subjectDefinitions.map((definition) => definition.area),
        ...plannerSessions.map((session) => getPlannerSessionArea(session)),
      ]),
    [areas, documents, plannerSessions, subjectDefinitions],
  )
  const uploadSubjectSuggestions = useMemo(
    () => getSubjectSuggestions(subjectDefinitions, uploadAreaInput),
    [subjectDefinitions, uploadAreaInput],
  )
  const plannerSubjectSuggestions = useMemo(
    () => getSubjectSuggestions(subjectDefinitions, plannerAreaInput),
    [plannerAreaInput, subjectDefinitions],
  )
  const noteSubjectSuggestions = useMemo(
    () => getSubjectSuggestions(subjectDefinitions, noteAreaInput),
    [noteAreaInput, subjectDefinitions],
  )
  const plannerStartMinutes = PLANNER_START_HOUR * 60
  const plannerEndMinutes = PLANNER_END_HOUR * 60
  const plannerTotalMinutes = plannerEndMinutes - plannerStartMinutes
  const selectedPlannerSessions = useMemo(
    () =>
      plannerSessions.filter(
        (session) =>
          getPlannerSessionDateKey(session, todayDateKey) === selectedPlannerDateKey,
      ),
    [plannerSessions, selectedPlannerDateKey, todayDateKey],
  )

  const plannerHours = useMemo(
    () =>
      Array.from({ length: PLANNER_END_HOUR - PLANNER_START_HOUR + 1 }, (_, index) => {
        const hour = PLANNER_START_HOUR + index
        return {
          value: hour,
          label: formatTimelineTime(hour * 60),
        }
      }),
    [],
  )

  const nowMarkerOffset = useMemo(() => {
    if (
      !isViewingToday ||
      nowInMinutes < plannerStartMinutes ||
      nowInMinutes > plannerEndMinutes
    ) {
      return null
    }

    return ((nowInMinutes - plannerStartMinutes) / plannerTotalMinutes) * 100
  }, [
    isViewingToday,
    nowInMinutes,
    plannerEndMinutes,
    plannerStartMinutes,
    plannerTotalMinutes,
  ])

  const activePlannerSession = useMemo(() => {
    if (!isViewingToday) {
      return null
    }

    return selectedPlannerSessions.find(
      (session) =>
        nowInMinutes >= session.startMinutes && nowInMinutes < session.endMinutes,
    )
  }, [isViewingToday, nowInMinutes, selectedPlannerSessions])

  const activePlannerProgress = useMemo(() => {
    if (!activePlannerSession) {
      return null
    }

    const totalMinutes =
      activePlannerSession.endMinutes - activePlannerSession.startMinutes
    const elapsedMinutes = nowInMinutes - activePlannerSession.startMinutes
    const remainingMinutes = activePlannerSession.endMinutes - nowInMinutes

    return {
      progress: Math.min(Math.max((elapsedMinutes / totalMinutes) * 100, 0), 100),
      remainingMinutes,
    }
  }, [activePlannerSession, nowInMinutes])
  const activePlannerSessionArea = activePlannerSession
    ? getPlannerSessionArea(activePlannerSession)
    : null
  const activePlannerSessionTone = activePlannerSessionArea
    ? getAreaTone(activePlannerSessionArea)
    : null
  const activePlannerSessionTitle = activePlannerSession
    ? getPlannerSessionTitle(activePlannerSession)
    : ''
  const activePlannerSessionNote = activePlannerSession
    ? normalizeLabel(activePlannerSession.note)
    : ''

  const plannerReviewSession = useMemo(
    () =>
      plannerSessions.find((session) =>
        isPlannerSessionReadyForReview(session, todayDateKey, nowInMinutes),
      ) ?? null,
    [nowInMinutes, plannerSessions, todayDateKey],
  )
  const filteredDocuments = useMemo(
    () =>
      documents.filter((document) =>
        activeLibraryAreaFilter === ALL_AREAS_FILTER
          ? true
          : document.area === activeLibraryAreaFilter,
      ),
    [activeLibraryAreaFilter, documents],
  )
  const filteredPlannerSessions = useMemo(
    () =>
      selectedPlannerSessions.filter((session) =>
        activePlannerAreaFilter === ALL_AREAS_FILTER
          ? true
          : getPlannerSessionArea(session) === activePlannerAreaFilter,
      ),
    [activePlannerAreaFilter, selectedPlannerSessions],
  )
  const reviewedPlannerSessions = useMemo(
    () =>
      plannerSessions.filter(
        (session) =>
          session.outcome === 'completed' || session.outcome === 'abandoned',
      ),
    [plannerSessions],
  )
  const completedPlannerSessions = useMemo(
    () =>
      reviewedPlannerSessions.filter((session) => session.outcome === 'completed'),
    [reviewedPlannerSessions],
  )
  const todayPlannerSessions = useMemo(
    () =>
      plannerSessions
        .filter(
          (session) => getPlannerSessionDateKey(session, todayDateKey) === todayDateKey,
        )
        .sort((left, right) => left.startMinutes - right.startMinutes),
    [plannerSessions, todayDateKey],
  )
  const todayCompletedSessions = useMemo(
    () =>
      completedPlannerSessions.filter(
        (session) => getPlannerSessionDateKey(session, todayDateKey) === todayDateKey,
      ),
    [completedPlannerSessions, todayDateKey],
  )
  const todayReviewedSessions = useMemo(
    () =>
      reviewedPlannerSessions.filter(
        (session) => getPlannerSessionDateKey(session, todayDateKey) === todayDateKey,
      ),
    [reviewedPlannerSessions, todayDateKey],
  )
  const activeTodaySession = useMemo(
    () =>
      todayPlannerSessions.find(
        (session) =>
          nowInMinutes >= session.startMinutes && nowInMinutes < session.endMinutes,
      ) ?? null,
    [nowInMinutes, todayPlannerSessions],
  )
  const activeTodaySessionElapsedMinutes = useMemo(() => {
    if (!activeTodaySession) {
      return 0
    }

    return clamp(nowInMinutes - activeTodaySession.startMinutes, 0, activeTodaySession.endMinutes - activeTodaySession.startMinutes)
  }, [activeTodaySession, nowInMinutes])
  const todayCompletedMinutes = useMemo(
    () =>
      todayCompletedSessions.reduce(
        (total, session) => total + (session.endMinutes - session.startMinutes),
        0,
      ),
    [todayCompletedSessions],
  )
  const todayGrowthMinutes = Math.min(
    todayCompletedMinutes +
      (activeTodaySession && activeTodaySession.outcome !== 'completed'
        ? activeTodaySessionElapsedMinutes
        : 0),
    DAILY_TREE_GOAL_MINUTES,
  )
  const dailyTreeProgress = todayGrowthMinutes / DAILY_TREE_GOAL_MINUTES
  const dailyTreeRemainingMinutes = Math.max(
    DAILY_TREE_GOAL_MINUTES - todayGrowthMinutes,
    0,
  )
  const todayCompletionRate =
    todayReviewedSessions.length > 0
      ? (todayCompletedSessions.length / todayReviewedSessions.length) * 100
      : null
  const todayUpcomingSessions = useMemo(
    () => todayPlannerSessions.filter((session) => session.endMinutes > nowInMinutes),
    [nowInMinutes, todayPlannerSessions],
  )
  const nextTodaySession = todayUpcomingSessions.find(
    (session) =>
      !activeTodaySession || session.id !== activeTodaySession.id,
  ) ?? null
  const currentWeekStart = useMemo(() => getStartOfWeek(now), [now])
  const lastWeekStart = useMemo(() => addDays(currentWeekStart, -7), [currentWeekStart])
  const currentWeekStartKey = useMemo(() => formatDateKey(currentWeekStart), [currentWeekStart])
  const lastWeekStartKey = useMemo(() => formatDateKey(lastWeekStart), [lastWeekStart])
  const weekSeries = useMemo(() => {
    return Array.from({ length: 8 }, (_, index) => {
      const weekStart = addDays(currentWeekStart, (index - 7) * 7)
      const weekEnd = addDays(weekStart, 7)
      const weekKey = formatDateKey(weekStart)
      const completed = completedPlannerSessions.filter((session) => {
        const sessionDate = createDateFromKey(getPlannerSessionDateKey(session, todayDateKey))
        return sessionDate >= weekStart && sessionDate < weekEnd
      })
      const reviewed = reviewedPlannerSessions.filter((session) => {
        const sessionDate = createDateFromKey(getPlannerSessionDateKey(session, todayDateKey))
        return sessionDate >= weekStart && sessionDate < weekEnd
      })
      const focusAverage = getAverage(
        completed
          .map((session) => session.focusScore)
          .filter((score): score is number => typeof score === 'number'),
      )

      return {
        key: weekKey,
        label: new Intl.DateTimeFormat(undefined, {
          day: 'numeric',
          month: 'short',
        }).format(weekStart),
        completedMinutes: completed.reduce(
          (total, session) => total + (session.endMinutes - session.startMinutes),
          0,
        ),
        completedCount: completed.length,
        reviewedCount: reviewed.length,
        completionRate:
          reviewed.length > 0 ? (completed.length / reviewed.length) * 100 : null,
        averageFocus: focusAverage,
      }
    })
  }, [completedPlannerSessions, currentWeekStart, reviewedPlannerSessions, todayDateKey])
  const currentWeekStats =
    weekSeries.find((week) => week.key === currentWeekStartKey) ?? weekSeries.at(-1) ?? null
  const lastWeekStats =
    weekSeries.find((week) => week.key === lastWeekStartKey) ??
    weekSeries.at(-2) ??
    null
  const weeklyTrendMaxMinutes = Math.max(
    ...weekSeries.map((week) => week.completedMinutes),
    1,
  )
  const completedDayKeys = useMemo(
    () =>
      Array.from(
        new Set(
          completedPlannerSessions.map((session) =>
            getPlannerSessionDateKey(session, todayDateKey),
          ),
        ),
      ).sort(),
    [completedPlannerSessions, todayDateKey],
  )
  const currentStreak = useMemo(() => {
    let streak = 0

    for (let offset = 0; ; offset += 1) {
      const dateKey = formatDateKey(addDays(createDateFromKey(todayDateKey), -offset))

      if (!completedDayKeys.includes(dateKey)) {
        break
      }

      streak += 1
    }

    return streak
  }, [completedDayKeys, todayDateKey])
  const bestStreak = useMemo(() => {
    if (completedDayKeys.length === 0) {
      return 0
    }

    let best = 0
    let current = 0
    let previousDateKey = ''

    for (const dateKey of completedDayKeys) {
      if (
        previousDateKey &&
        formatDateKey(addDays(createDateFromKey(previousDateKey), 1)) === dateKey
      ) {
        current += 1
      } else {
        current = 1
      }

      best = Math.max(best, current)
      previousDateKey = dateKey
    }

    return best
  }, [completedDayKeys])
  const allTimeCompletedMinutes = completedPlannerSessions.reduce(
    (total, session) => total + (session.endMinutes - session.startMinutes),
    0,
  )
  const allTimeFocusAverage = getAverage(
    completedPlannerSessions
      .map((session) => session.focusScore)
      .filter((score): score is number => typeof score === 'number'),
  )
  const dailyHeatmap = useMemo(() => {
    return Array.from({ length: 28 }, (_, index) => {
      const date = addDays(createDateFromKey(todayDateKey), index - 27)
      const dateKey = formatDateKey(date)
      const sessions = completedPlannerSessions.filter(
        (session) => getPlannerSessionDateKey(session, todayDateKey) === dateKey,
      )
      const minutes = sessions.reduce(
        (total, session) => total + (session.endMinutes - session.startMinutes),
        0,
      )

      return {
        dateKey,
        dayLabel: new Intl.DateTimeFormat(undefined, { day: 'numeric' }).format(date),
        minutes,
        sessions: sessions.length,
      }
    })
  }, [completedPlannerSessions, todayDateKey])
  const heatmapMaxMinutes = Math.max(...dailyHeatmap.map((day) => day.minutes), 1)
  const areaStats = useMemo(() => {
    return areaFilterOptions
      .map((areaName) => {
        const completed = completedPlannerSessions.filter(
          (session) => getPlannerSessionArea(session) === areaName,
        )
        const reviewed = reviewedPlannerSessions.filter(
          (session) => getPlannerSessionArea(session) === areaName,
        )
        const focusAverage = getAverage(
          completed
            .map((session) => session.focusScore)
            .filter((score): score is number => typeof score === 'number'),
        )

        return {
          area: areaName,
          minutes: completed.reduce(
            (total, session) => total + (session.endMinutes - session.startMinutes),
            0,
          ),
          completedCount: completed.length,
          abandonedCount: reviewed.filter((session) => session.outcome === 'abandoned').length,
          averageFocus: focusAverage,
        }
      })
      .filter((area) => area.minutes > 0 || area.completedCount > 0 || area.abandonedCount > 0)
      .sort((left, right) => right.minutes - left.minutes)
  }, [areaFilterOptions, completedPlannerSessions, reviewedPlannerSessions])
  const areaStatsMaxMinutes = Math.max(...areaStats.map((area) => area.minutes), 1)
  const subjectStats = useMemo(() => {
    const groupedSubjects = new Map<
      string,
      {
        area: string
        label: string
        minutes: number
        completedCount: number
        focusScores: number[]
      }
    >()

    for (const session of completedPlannerSessions) {
      const area = getPlannerSessionArea(session)
      const label = getSubjectFocusValue(session.subject) || 'No focus'
      const key = `${area}::${label}`
      const entry =
        groupedSubjects.get(key) ?? {
          area,
          label,
          minutes: 0,
          completedCount: 0,
          focusScores: [],
        }

      entry.minutes += session.endMinutes - session.startMinutes
      entry.completedCount += 1

      if (typeof session.focusScore === 'number') {
        entry.focusScores.push(session.focusScore)
      }

      groupedSubjects.set(key, entry)
    }

    return Array.from(groupedSubjects.values())
      .map((entry) => ({
        ...entry,
        averageFocus: getAverage(entry.focusScores),
      }))
      .sort((left, right) => right.minutes - left.minutes)
      .slice(0, 6)
  }, [completedPlannerSessions])
  const subjectStatsMaxMinutes = Math.max(...subjectStats.map((subject) => subject.minutes), 1)
  const hourlyStats = useMemo(() => {
    return Array.from(
      { length: PLANNER_END_HOUR - PLANNER_START_HOUR },
      (_, index) => {
        const hour = PLANNER_START_HOUR + index
        const sessions = completedPlannerSessions.filter(
          (session) => Math.floor(session.startMinutes / 60) === hour,
        )
        const focusAverage = getAverage(
          sessions
            .map((session) => session.focusScore)
            .filter((score): score is number => typeof score === 'number'),
        )

        return {
          hour,
          label: new Intl.DateTimeFormat(undefined, {
            hour: 'numeric',
            hour12: false,
          }).format(new Date(2024, 0, 1, hour, 0)),
          minutes: sessions.reduce(
            (total, session) => total + (session.endMinutes - session.startMinutes),
            0,
          ),
          completedCount: sessions.length,
          averageFocus: focusAverage,
        }
      },
    )
  }, [completedPlannerSessions])
  const hourlyMaxMinutes = Math.max(...hourlyStats.map((hour) => hour.minutes), 1)
  const overviewComparisons = {
    minutes:
      (currentWeekStats?.completedMinutes ?? 0) - (lastWeekStats?.completedMinutes ?? 0),
    sessions:
      (currentWeekStats?.completedCount ?? 0) - (lastWeekStats?.completedCount ?? 0),
    completionRate:
      Math.round(
        (currentWeekStats?.completionRate ?? 0) - (lastWeekStats?.completionRate ?? 0),
      ),
    focus:
      Math.round(
        ((currentWeekStats?.averageFocus ?? 0) - (lastWeekStats?.averageFocus ?? 0)) * 10,
      ) / 10,
  }

  useEffect(() => {
    const previousTodayDateKey = previousTodayDateKeyRef.current

    if (selectedPlannerDateKey === previousTodayDateKey) {
      setSelectedPlannerDateKey(todayDateKey)
    }

    previousTodayDateKeyRef.current = todayDateKey
  }, [selectedPlannerDateKey, todayDateKey])

  const clearAuthTimeout = useCallback(() => {
    if (authTimeoutRef.current !== null) {
      window.clearTimeout(authTimeoutRef.current)
      authTimeoutRef.current = null
    }
  }, [])

  const registerArea = useCallback((areaName: string) => {
    const normalizedArea = normalizeLabel(areaName)

    if (!normalizedArea) {
      return
    }

    setAreas((currentAreas) => mergeAreas(currentAreas, [normalizedArea]))
  }, [])

  const registerSubjectDefinition = useCallback(
    (areaName: string, subjectName: string) => {
      const normalizedArea = normalizeLabel(areaName)
      const normalizedSubject = getSubjectFocusValue(subjectName)

      if (!normalizedArea || !normalizedSubject) {
        return
      }

      registerArea(normalizedArea)
      setSubjectDefinitions((currentDefinitions) =>
        mergeSubjectDefinitions(currentDefinitions, [
          { area: normalizedArea, name: normalizedSubject },
        ]),
      )
    },
    [registerArea],
  )

  const loadDriveDocuments = useCallback(async (tokenOverride?: string) => {
    const token = tokenOverride ?? accessTokenRef.current

    if (!token) {
      return
    }

    try {
      const folderId = await ensureDriveFolder(token)
      const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`)

        const response = await driveRequest<{
          files: Array<{
            id: string
            name: string
            webViewLink?: string
            createdTime?: string
            appProperties?: {
              area?: string
              subject?: string
              type?: string
              tags?: string
              displayName?: string
          }
        }>
      }>(
        token,
        `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,webViewLink,createdTime,appProperties)&orderBy=createdTime desc`,
      )

      const nextDocuments = response.files.map((file) => ({
        id: file.id,
        area:
          normalizeLabel(file.appProperties?.area ?? '') ||
            getSubjectArea(subjectDefinitionsRef.current, file.appProperties?.subject ?? ''),
        title: file.appProperties?.displayName?.trim() || file.name,
        subject: getSubjectFocusValue(file.appProperties?.subject ?? ''),
        type: file.appProperties?.type || 'File',
        meta: formatDriveMeta(file.createdTime),
        tags: parseTags(file.appProperties?.tags || ''),
        link: file.webViewLink,
      }))

      setAreas((currentAreas) =>
        mergeAreas(currentAreas, nextDocuments.map((document) => document.area)),
      )
      setSubjectDefinitions((currentDefinitions) =>
        mergeSubjectDefinitions(
          currentDefinitions,
          nextDocuments
            .filter((document) => document.subject.length > 0)
            .map((document) => ({ area: document.area, name: document.subject })),
        ),
      )
      setDocuments(nextDocuments)
      setStatusMessage(
        nextDocuments.length > 0
          ? `Google Drive connected. ${nextDocuments.length} file${nextDocuments.length > 1 ? 's' : ''} loaded.`
          : 'Google Drive connected. No files yet.',
      )
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? `Could not load Drive files: ${error.message}`
          : 'Could not load Drive files.',
      )
    }
  }, [])

  const syncPlannerSessionToSheets = useCallback(
    async (session: PlannerSession, tokenOverride?: string) => {
      const token = tokenOverride ?? accessTokenRef.current

      if (!token || !session.outcome || session.sheetsSyncStatus === 'synced') {
        return false
      }

      if (plannerSyncingSessionIdsRef.current.has(session.id)) {
        return false
      }

      plannerSyncingSessionIdsRef.current.add(session.id)
      setPlannerSessions((currentSessions) =>
        currentSessions.map((currentSession) =>
          currentSession.id === session.id
            ? { ...currentSession, sheetsSyncStatus: 'syncing' }
            : currentSession,
        ),
      )

      try {
        await appendPlannerSessionToSheet(token, session, todayDateKey)

        setPlannerSessions((currentSessions) =>
          currentSessions.map((currentSession) =>
            currentSession.id === session.id
              ? {
                  ...currentSession,
                  sheetsSyncStatus: 'synced',
                  sheetsSyncedAt: new Date().toISOString(),
                }
              : currentSession,
          ),
        )
        setStatusMessage('Session saved to Google Sheets.')
        return true
      } catch (error) {
        setPlannerSessions((currentSessions) =>
          currentSessions.map((currentSession) =>
            currentSession.id === session.id
              ? { ...currentSession, sheetsSyncStatus: 'failed' }
              : currentSession,
          ),
        )
        setStatusMessage(
          error instanceof Error
            ? `Could not save session log: ${error.message}`
            : 'Could not save session log.',
        )
        return false
      } finally {
        plannerSyncingSessionIdsRef.current.delete(session.id)
      }
    },
    [todayDateKey],
  )

  const flushPendingPlannerSessionLogs = useCallback(
    async (tokenOverride?: string) => {
      const token = tokenOverride ?? accessTokenRef.current

      if (!token) {
        return
      }

      const pendingSessions = plannerSessions.filter(
        (session) =>
          session.outcome &&
          (session.sheetsSyncStatus === undefined ||
            session.sheetsSyncStatus === 'pending' ||
            session.sheetsSyncStatus === 'failed'),
      )

      for (const session of pendingSessions) {
        const synced = await syncPlannerSessionToSheets(session, token)

        if (!synced) {
          break
        }
      }
    },
    [plannerSessions, syncPlannerSessionToSheets],
  )

  const uploadFiles = useCallback(
    async (
      uploads: PendingUploadItem[],
      areaName: string,
      subjectName: string,
      tokenOverride?: string,
    ): Promise<void> => {
      const token = tokenOverride ?? accessTokenRef.current

      if (!token || uploads.length === 0 || !areaName) {
        return
      }

      try {
        setIsUploading(true)
        setStatusMessage(
          `Uploading ${uploads.length} file${uploads.length > 1 ? 's' : ''} to Google Drive...`,
        )

        const folderId = await ensureDriveFolder(token)
        const tags = parseTags(tagValue)

        const uploadedDocuments = await Promise.all(
          uploads.map(async ({ file, displayName }) => {
            const uploadedFile = await uploadFileToDrive(
              token,
              file,
              folderId,
              areaName,
              subjectName,
              selectedType,
              tags,
              displayName.trim() || file.name,
            )

            return {
              id: uploadedFile.id,
              area: areaName,
              title: displayName.trim() || uploadedFile.name,
              subject: subjectName,
              type: selectedType,
              meta: 'Uploaded just now',
              tags,
              link: uploadedFile.webViewLink,
            } satisfies DocumentItem
          }),
        )

        registerSubjectDefinition(areaName, subjectName)
        setDocuments((currentDocuments) => [...uploadedDocuments, ...currentDocuments])
        pendingUploadsRef.current = []
        setPendingUploads([])
        setUploadAreaInput(areaName)
        setUploadSubjectInput(subjectName)
        await loadDriveDocuments(token)
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? `Upload failed: ${error.message}`
            : 'Upload failed.',
        )
      } finally {
        setIsUploading(false)
        setIsDragActive(false)
      }
    },
    [loadDriveDocuments, registerSubjectDefinition, selectedType, tagValue],
  )

  const startAuthRequest = useCallback(
    (mode: 'manual' | 'auto', prompt: string) => {
      if (!tokenClientRef.current) {
        setStatusMessage('Google Drive sign-in is still loading.')
        return
      }

      authModeRef.current = mode
      clearAuthTimeout()
      setIsAuthenticating(true)
      setStatusMessage(
        mode === 'auto'
          ? 'Reconnecting to Google Drive...'
          : 'Connecting to Google Drive...',
      )

      authTimeoutRef.current = window.setTimeout(() => {
        setIsAuthenticating(false)
        setStatusMessage(
          mode === 'auto'
            ? 'Connect Google Drive to upload files across devices.'
            : 'Google Drive sign-in timed out. Try again.',
        )
      }, mode === 'auto' ? 8000 : 60000)

      try {
        tokenClientRef.current.requestAccessToken({ prompt })
      } catch {
        clearAuthTimeout()
        setIsAuthenticating(false)
        setStatusMessage('Google Drive sign-in could not start.')
      }
    },
    [clearAuthTimeout],
  )

  useEffect(() => {
    const initializeGoogle = async () => {
      try {
        await loadGoogleIdentityScript()

        if (!window.google?.accounts?.oauth2) {
          throw new Error('Google Identity Services did not load correctly.')
        }

        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: GOOGLE_SCOPES,
          callback: (response) => {
            clearAuthTimeout()
            setIsAuthenticating(false)

            if (response.error || !response.access_token) {
              setStatusMessage(
                authModeRef.current === 'auto'
                  ? 'Connect Google Drive to upload files across devices.'
                  : 'Google Drive sign-in did not complete.',
              )
              return
            }

             setAccessToken(response.access_token)
             localStorage.setItem(DRIVE_AUTO_CONNECT_KEY, 'true')
             void loadDriveDocuments(response.access_token)
             void flushPendingPlannerSessionLogs(response.access_token)

             if (pendingUploadsRef.current.length > 0) {
               setStatusMessage('Choose an area and name, then upload your file.')
            }
          },
          error_callback: () => {
            clearAuthTimeout()
            setIsAuthenticating(false)
            setStatusMessage(
              authModeRef.current === 'auto'
                ? 'Connect Google Drive to upload files across devices.'
                : 'Google Drive sign-in did not complete.',
            )
          },
        })

        if (localStorage.getItem(DRIVE_AUTO_CONNECT_KEY) === 'true') {
          startAuthRequest('auto', '')
        }
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : 'Could not load Google Drive tools.',
        )
      }
    }

    void initializeGoogle()
    return () => {
      clearAuthTimeout()
    }
  }, [clearAuthTimeout, flushPendingPlannerSessionLogs, loadDriveDocuments, startAuthRequest])

  const connectDrive = () => {
    startAuthRequest('manual', accessTokenRef.current ? '' : 'consent')
  }

  const handleIncomingFiles = (files: File[]) => {
    if (files.length === 0) {
      return
    }

    const nextPendingUploads = createPendingUploadItems(files)
    pendingUploadsRef.current = nextPendingUploads
    setPendingUploads(nextPendingUploads)

    if (accessTokenRef.current) {
      setStatusMessage('Choose an area and name, then upload your file.')
      return
    }

    setStatusMessage('Connect Google Drive to finish uploading your file.')
    connectDrive()
  }

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const incomingFiles = Array.from(event.target.files ?? [])
    handleIncomingFiles(incomingFiles)
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    handleIncomingFiles(Array.from(event.dataTransfer.files))
  }

  const handlePendingUploadNameChange = (key: string, value: string) => {
    setPendingUploads((currentUploads) => {
      const nextUploads = currentUploads.map((upload) =>
        upload.key === key ? { ...upload, displayName: value } : upload,
      )

      pendingUploadsRef.current = nextUploads
      return nextUploads
    })
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!isDragActive) {
      setIsDragActive(true)
    }
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }

    setIsDragActive(false)
  }

  const handleUploadButtonClick = () => {
    if (!accessTokenRef.current) {
      connectDrive()
      return
    }

    if (pendingUploadsRef.current.length > 0) {
      const resolvedArea = normalizeLabel(uploadAreaInput)
      const resolvedSubject = getSubjectFocusValue(uploadSubjectInput)

      if (!resolvedArea) {
        setStatusMessage('Add an area before uploading.')
        return
      }

      const hasEmptyName = pendingUploadsRef.current.some(
        ({ displayName }) => displayName.trim().length === 0,
      )

      if (hasEmptyName) {
        setStatusMessage('Add a name for every file before uploading.')
        return
      }

      void uploadFiles(pendingUploadsRef.current, resolvedArea, resolvedSubject)
      return
    }

    fileInputRef.current?.click()
  }

  const handleClearPendingFiles = () => {
    pendingUploadsRef.current = []
    setPendingUploads([])
    setUploadAreaInput(
      activeLibraryAreaFilter === ALL_AREAS_FILTER
        ? DEFAULT_AREA_NAME
        : activeLibraryAreaFilter,
    )
    setUploadSubjectInput('')
    setStatusMessage(
      accessTokenRef.current
        ? 'Google Drive connected. Choose files to upload.'
        : 'Connect Google Drive to upload files across devices.',
    )
  }

  const handleDeleteDocument = async (document: DocumentItem) => {
    if (!document.id) {
      setDocuments((currentDocuments) =>
        currentDocuments.filter(
          (currentDocument) =>
            !(
              currentDocument.title === document.title &&
              currentDocument.meta === document.meta
            ),
        ),
      )
      return
    }

    if (!accessTokenRef.current) {
      setStatusMessage('Connect Google Drive before deleting files.')
      connectDrive()
      return
    }

    try {
      setIsUploading(true)
      setStatusMessage(`Deleting ${document.title} from Google Drive...`)
      await deleteFileFromDrive(accessTokenRef.current, document.id)
      await loadDriveDocuments(accessTokenRef.current)
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? `Delete failed: ${error.message}`
          : 'Delete failed.',
      )
    } finally {
      setIsUploading(false)
    }
  }

  const getPlannerSlotMinutes = useCallback(
    (clientX: number) => {
      const track = plannerTrackRef.current

      if (!track) {
        return null
      }

      const rect = track.getBoundingClientRect()

      if (rect.width === 0) {
        return null
      }

      const clampedOffset = Math.min(Math.max(clientX - rect.left, 0), rect.width)
      const totalSlots = plannerTotalMinutes / PLANNER_STEP_MINUTES
      const rawSlot = Math.floor((clampedOffset / rect.width) * totalSlots)
      const slotIndex = Math.min(Math.max(rawSlot, 0), totalSlots - 1)

      return plannerStartMinutes + slotIndex * PLANNER_STEP_MINUTES
    },
    [plannerStartMinutes, plannerTotalMinutes],
  )

  const handleTogglePlannerSelection = () => {
    setIsPlannerSelecting((currentValue) => {
      const nextValue = !currentValue

      if (nextValue) {
        plannerPointerDownRef.current = false
        setPlannerSelectionStage('start')
        setPlannerSelectionStartMinutes(null)
        setPlannerPreviewMinutes(null)
        setPlannerSelectionMessage('Release to set the start time.')
      } else {
        plannerPointerDownRef.current = false
        setPlannerPreviewMinutes(null)
        setPlannerSelectionStage('start')
        setPlannerSelectionStartMinutes(null)
        setPlannerPendingArea(DEFAULT_AREA_NAME)
        setPlannerPendingSubject('')
        setPlannerPendingNote('')
        setPlannerSelectionMessage('')
      }
      return nextValue
    })
  }

  const handleOpenPlannerSetup = () => {
    setPlannerAreaInput(
      activePlannerAreaFilter === ALL_AREAS_FILTER
        ? DEFAULT_AREA_NAME
        : activePlannerAreaFilter,
    )
    setPlannerSubjectInput('')
    setPlannerNoteInput('')
    setPlannerSetupError('')
    setIsPlannerSetupOpen(true)
  }

  const handleClosePlannerSetup = () => {
    setIsPlannerSetupOpen(false)
    setPlannerSetupError('')
  }

  const handleStartPlannerSelection = () => {
    const area = normalizeLabel(plannerAreaInput)
    const subject = getSubjectFocusValue(plannerSubjectInput)

    if (!area) {
      setPlannerSetupError('Add an area.')
      return
    }

    registerSubjectDefinition(area, subject)
    setPlannerPendingArea(area)
    setPlannerPendingSubject(subject)
    setPlannerPendingNote(plannerNoteInput.trim())
    setPlannerSetupError('')
    setIsPlannerSetupOpen(false)
    setIsPlannerSelecting(true)
    plannerPointerDownRef.current = false
    setPlannerSelectionStage('start')
    setPlannerSelectionStartMinutes(null)
    setPlannerPreviewMinutes(null)
    setPlannerSelectionMessage('Release to set the start time.')
  }

  const handlePlannerTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isPlannerSelecting || event.button !== 0) {
      return
    }

    if ((event.target as HTMLElement).closest('.planner-session')) {
      return
    }

    const slotMinutes = getPlannerSlotMinutes(event.clientX)

    if (slotMinutes === null) {
      return
    }

    plannerPointerDownRef.current = true
    setPlannerPreviewMinutes(slotMinutes)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePlannerTrackPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!plannerPointerDownRef.current) {
      return
    }

    const slotMinutes = getPlannerSlotMinutes(event.clientX)

    if (slotMinutes === null) {
      return
    }

    setPlannerPreviewMinutes(slotMinutes)
  }

  const handlePlannerTrackPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!plannerPointerDownRef.current) {
      return
    }

    const slotMinutes = getPlannerSlotMinutes(event.clientX)
    plannerPointerDownRef.current = false
    setPlannerPreviewMinutes(null)
    event.currentTarget.releasePointerCapture(event.pointerId)

    if (slotMinutes === null) {
      return
    }

    if (plannerSelectionStage === 'start') {
      setPlannerSelectionStartMinutes(slotMinutes)
      setPlannerSelectionStage('end')
      setPlannerSelectionMessage('Release again to set the end time.')
      return
    }

    if (plannerSelectionStartMinutes === null) {
      return
    }

    const nextSessionStart = Math.min(plannerSelectionStartMinutes, slotMinutes)
    const nextSessionEnd =
      Math.max(plannerSelectionStartMinutes, slotMinutes) + PLANNER_STEP_MINUTES

    if (hasPlannerOverlap(selectedPlannerSessions, nextSessionStart, nextSessionEnd)) {
      setPlannerSelectionMessage('This overlaps another session.')
      return
    }

    setPlannerSessions((currentSessions) =>
      [
        ...currentSessions,
          {
            id: `session-${Date.now()}`,
            area: plannerPendingArea,
            subject: plannerPendingSubject,
            note: plannerPendingNote,
            startMinutes: nextSessionStart,
            endMinutes: nextSessionEnd,
            sessionDate: selectedPlannerDateKey,
          },
        ].sort((left, right) => left.startMinutes - right.startMinutes),
    )
    setPlannerSelectionStage('start')
    setPlannerSelectionStartMinutes(null)
    setPlannerPendingArea(DEFAULT_AREA_NAME)
    setPlannerPendingSubject('')
    setPlannerPendingNote('')
    setPlannerSelectionMessage('')
    setIsPlannerSelecting(false)
  }

  const handlePlannerReviewSubmit = async () => {
    if (!plannerReviewSession) {
      return
    }

    if (plannerReviewSubmitLockRef.current) {
      return
    }

    if (!plannerReviewOutcome) {
      setPlannerReviewError('Choose completed or abandoned.')
      return
    }

    plannerReviewSubmitLockRef.current = true

    const reviewedSession: PlannerSession = {
      ...plannerReviewSession,
      outcome: plannerReviewOutcome,
      focusScore:
        plannerReviewOutcome === 'completed' ? plannerReviewFocusScore : undefined,
      reviewedAt: new Date().toISOString(),
      sheetsSyncStatus: accessTokenRef.current ? 'syncing' : 'pending',
      sheetsSyncedAt: undefined,
    }

    setPlannerSessions((currentSessions) =>
      currentSessions.map((session) =>
        session.id === plannerReviewSession.id ? reviewedSession : session,
      ),
    )
    setPlannerReviewOutcome('')
    setPlannerReviewFocusScore(8)
    setPlannerReviewError('')

    if (accessTokenRef.current) {
      await syncPlannerSessionToSheets(reviewedSession)
      plannerReviewSubmitLockRef.current = false
      return
    }

    setStatusMessage('Session saved locally. Connect Google Drive to sync it to Google Sheets.')
    connectDrive()
    plannerReviewSubmitLockRef.current = false
  }

  const uploadButtonLabel = accessToken
    ? pendingUploads.length > 0
      ? `Upload ${pendingUploads.length} file${pendingUploads.length > 1 ? 's' : ''}`
      : 'Choose files'
    : 'Connect Drive'

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="wordmark"
          href="/"
          aria-label="StudieRommet home"
          onClick={(event) => {
            event.preventDefault()
            setCurrentView('dashboard')
          }}
        >
          StudieRommet
        </a>

        <nav className="topnav" aria-label="Primary">
          {navItems.map((item) => (
            item.view ? (
              <button
                key={item.label}
                className={currentView === item.view ? 'nav-link is-active' : 'nav-link'}
                type="button"
                onClick={() => setCurrentView(item.view!)}
              >
                {item.label}
              </button>
            ) : (
              <span key={item.label} className="nav-link nav-link--static">
                {item.label}
              </span>
            )
          ))}
        </nav>

        <div className="topbar-right">
          <button
            className="upload-button"
            type="button"
            onClick={handleUploadButtonClick}
            disabled={isAuthenticating || isUploading}
          >
            {isUploading ? 'Uploading...' : isAuthenticating ? 'Connecting...' : uploadButtonLabel}
          </button>

          <time className="clock" dateTime={now.toISOString()} aria-live="polite">
            {formattedTime}
          </time>
        </div>
      </header>

      <main className="dashboard">
        {currentView === 'dashboard' ? (
          <section className="dashboard-panel dashboard-home" aria-labelledby="home-title">
            <div className="dashboard-panel__header">
              <div>
                <p className="eyebrow">Dashboard</p>
                <h1 id="home-title">Grow today</h1>
              </div>
            </div>

            <div className="dashboard-home__content">
              <section className="dashboard-home__hero">
                <article className="tree-card">
                  <div className="tree-card__copy">
                    <span className="tree-card__eyebrow">Daily tree</span>
                    <strong className="tree-card__value">{formatDuration(todayGrowthMinutes)}</strong>
                    <span className="tree-card__subtle">
                      {dailyTreeRemainingMinutes > 0
                        ? `${formatDuration(dailyTreeRemainingMinutes)} until full growth`
                        : 'Fully grown for today'}
                    </span>
                  </div>

                  <div className="tree-card__visual">
                    <DailyGrowthTree progress={dailyTreeProgress} />
                  </div>

                  <div className="tree-card__footer">
                    <div className="tree-progress">
                      <div className="tree-progress__labels">
                        <span>{Math.round(dailyTreeProgress * 100)}%</span>
                        <span>7h goal</span>
                      </div>
                      <div className="tree-progress__track" aria-label="Daily tree progress">
                        <span
                          className="tree-progress__fill"
                          style={{ width: `${dailyTreeProgress * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </article>

                <div className="dashboard-home__stats">
                  <article className="home-stat-card home-stat-card--primary">
                    <span className="home-stat-card__label">Today</span>
                    <strong className="home-stat-card__value">
                      {formatDuration(todayCompletedMinutes)}
                    </strong>
                    <span className="home-stat-card__meta">
                      {todayCompletedSessions.length} completed session
                      {todayCompletedSessions.length === 1 ? '' : 's'}
                    </span>
                  </article>

                  <article className="home-stat-card">
                    <span className="home-stat-card__label">Streak</span>
                    <strong className="home-stat-card__value">{currentStreak}</strong>
                    <span className="home-stat-card__meta">Best {bestStreak}</span>
                  </article>

                  <article className="home-stat-card">
                    <span className="home-stat-card__label">This week</span>
                    <strong className="home-stat-card__value">
                      {formatDuration(currentWeekStats?.completedMinutes ?? 0)}
                    </strong>
                    <span className="home-stat-card__meta">
                      {formatMetricDelta(overviewComparisons.minutes, 'm')} vs last week
                    </span>
                  </article>

                  <article className="home-stat-card">
                    <span className="home-stat-card__label">Completion</span>
                    <strong className="home-stat-card__value">
                      {todayCompletionRate === null ? '--' : formatPercent(todayCompletionRate)}
                    </strong>
                    <span className="home-stat-card__meta">
                      {todayReviewedSessions.length > 0
                        ? `${todayReviewedSessions.length} reviewed today`
                        : 'No reviews yet'}
                    </span>
                  </article>
                </div>
              </section>

              <section className="dashboard-home__secondary">
                <article className="dashboard-surface">
                  <div className="dashboard-surface__header">
                    <h2>Today&apos;s sessions</h2>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        setSelectedPlannerDateKey(todayDateKey)
                        setCurrentView('planner')
                      }}
                    >
                      Open planner
                    </button>
                  </div>

                  {todayPlannerSessions.length > 0 ? (
                    <div className="today-session-list">
                      {todayPlannerSessions.map((session) => {
                        const sessionArea = getPlannerSessionArea(session)
                        const areaTone = getAreaTone(sessionArea)
                        const isActive =
                          activeTodaySession?.id === session.id &&
                          nowInMinutes >= session.startMinutes &&
                          nowInMinutes < session.endMinutes
                        const statusLabel =
                          session.outcome === 'completed'
                            ? 'Completed'
                            : session.outcome === 'abandoned'
                              ? 'Abandoned'
                              : isActive
                                ? 'In progress'
                                : session.startMinutes > nowInMinutes
                                  ? 'Planned'
                                  : 'Awaiting review'

                        return (
                          <article key={session.id} className="today-session-item">
                            <div className="today-session-item__title">
                              <span
                                className="area-pill area-pill--small"
                                style={{
                                  backgroundColor: areaTone.background,
                                  borderColor: areaTone.border,
                                  color: areaTone.text,
                                }}
                              >
                                {sessionArea}
                              </span>
                              <div>
                                <strong>{getPlannerSessionTitle(session)}</strong>
                                {getSubjectFocusValue(session.subject) ? (
                                  <span>{getSubjectFocusValue(session.subject)}</span>
                                ) : null}
                              </div>
                            </div>
                            <div className="today-session-item__meta">
                              <span>
                                {formatTimelineTime(session.startMinutes)} -{' '}
                                {formatTimelineTime(session.endMinutes)}
                              </span>
                              <span
                                className={
                                  statusLabel === 'Completed'
                                    ? 'today-session-item__status is-complete'
                                    : statusLabel === 'Abandoned'
                                      ? 'today-session-item__status is-abandoned'
                                      : statusLabel === 'In progress'
                                        ? 'today-session-item__status is-active'
                                        : 'today-session-item__status'
                                }
                              >
                                {statusLabel}
                              </span>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="dashboard-empty-state">No sessions planned yet</div>
                  )}
                </article>

                <div className="dashboard-stack">
                  <article className="dashboard-surface dashboard-surface--accent">
                    <span className="home-stat-card__label">Next up</span>
                    <strong className="home-stat-card__value dashboard-surface__value">
                      {nextTodaySession ? getPlannerSessionTitle(nextTodaySession) : 'Nothing queued'}
                    </strong>
                    <span className="home-stat-card__meta">
                      {nextTodaySession
                        ? `${formatTimelineTime(nextTodaySession.startMinutes)} - ${formatTimelineTime(nextTodaySession.endMinutes)}`
                        : 'Plan a session when you are ready'}
                    </span>
                  </article>

                  <article className="dashboard-surface">
                    <div className="dashboard-surface__header">
                      <h2>This week</h2>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => setCurrentView('insights')}
                      >
                        Open insights
                      </button>
                    </div>
                    <div className="dashboard-week-strip">
                      {weekSeries.slice(-4).map((week) => (
                        <div key={week.key} className="dashboard-week-strip__item">
                          <span>{week.label}</span>
                          <strong>{formatDuration(week.completedMinutes)}</strong>
                        </div>
                      ))}
                    </div>
                  </article>
                </div>
              </section>
            </div>
          </section>
        ) : currentView === 'library' ? (
          <section className="dashboard-panel" aria-labelledby="dashboard-title">
            <div className="dashboard-panel__header">
              <div>
                <p className="eyebrow">Library</p>
                <h1 id="dashboard-title">Notes and documents</h1>
              </div>

              <button
                className="secondary-button"
                type="button"
                onClick={() => setCurrentView('note')}
              >
                New note
              </button>
            </div>

            <div className="panel-filter-bar">
              <div className="filter-row" aria-label="Area filters">
                {[ALL_AREAS_FILTER, ...areaFilterOptions].map((areaName) => {
                  const areaTone =
                    areaName === ALL_AREAS_FILTER ? null : getAreaTone(areaName)

                  return (
                    <button
                      key={areaName}
                      className={
                        activeLibraryAreaFilter === areaName
                          ? 'filter-chip area-filter-chip is-active'
                          : 'filter-chip area-filter-chip'
                      }
                      type="button"
                      onClick={() => setActiveLibraryAreaFilter(areaName)}
                      style={
                        areaTone
                          ? {
                              borderColor: areaTone.border,
                              color: areaTone.text,
                            }
                          : undefined
                      }
                    >
                      {areaName}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="library-grid">
              <section className="upload-panel">
                <div
                  className={isDragActive ? 'dropzone is-active' : 'dropzone'}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  <p className="dropzone-title">Drop files here</p>
                  <p className="dropzone-copy">{statusMessage}</p>
                  {pendingUploads.length > 0 ? (
                    <div className="pending-files">
                      {pendingUploads.map((upload) => (
                        <span key={upload.key} className="pending-file">
                          {upload.displayName || upload.file.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={handleUploadButtonClick}
                    disabled={isAuthenticating || isUploading}
                  >
                    {uploadButtonLabel}
                  </button>
                  <input
                    ref={fileInputRef}
                    className="file-input"
                    type="file"
                    multiple
                    onChange={handleFileInputChange}
                  />
                </div>
              </section>

              <section className="documents-panel" aria-labelledby="document-list-title">
                <div className="documents-panel__header">
                  <h2 id="document-list-title">Recent documents</h2>
                </div>

                <div className="documents-panel__tools">
                  <div className="library-search">
                    <label className="search-field">
                      <span className="sr-only">Search notes and documents</span>
                      <input type="search" placeholder="Search notes and documents" />
                    </label>

                    <button className="secondary-button" type="button">
                      Filters
                    </button>
                  </div>

                  <div className="filter-row" aria-label="Content filters">
                    {filters.map((filter) => (
                      <button
                        key={filter}
                        className={filter === 'All' ? 'filter-chip is-active' : 'filter-chip'}
                        type="button"
                      >
                        {filter}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="document-list">
                  {filteredDocuments.length > 0 ? (
                    filteredDocuments.map((document) => {
                      const areaTone = getAreaTone(document.area)
                      const subjectTone = getSubjectTone(document.area, document.subject)
                      const subjectFocus = getSubjectFocusValue(document.subject)
                      const typeIndicator = getTypeIndicator(document.type)
                      const documentCardStyle: CSSProperties = {
                        backgroundColor: subjectTone.background,
                        borderColor: subjectTone.border,
                      }

                      return (
                        <article
                          key={`${document.id ?? document.title}-${document.meta}`}
                          className="document-card"
                          style={documentCardStyle}
                        >
                          <div className="document-card__top">
                            <div>
                              <div className="document-card__context">
                                <span
                                  className="area-pill"
                                  style={{
                                    backgroundColor: areaTone.background,
                                    borderColor: areaTone.border,
                                    color: areaTone.text,
                                  }}
                                >
                                  {document.area}
                                </span>
                                {subjectFocus ? <p>{subjectFocus}</p> : null}
                              </div>
                              {document.link ? (
                                <a
                                  className="document-link"
                                  href={document.link}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  {document.title}
                                </a>
                              ) : (
                                <h3>{document.title}</h3>
                              )}
                            </div>
                            <div className="document-card__actions">
                              <button
                                className="delete-button"
                                type="button"
                                onClick={() => void handleDeleteDocument(document)}
                                disabled={isUploading || isAuthenticating}
                              >
                                Delete
                              </button>
                            </div>
                          </div>

                          <div className="document-card__bottom">
                            <span>{document.meta}</span>
                            <div className="tag-list">
                              {document.tags.map((tag) => (
                                <span key={tag} className="tag">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div
                            className="document-card__indicator"
                            aria-label={`Type: ${typeIndicator.label}`}
                          >
                            <span className="document-card__indicator-symbol">
                              {typeIndicator.symbol}
                            </span>
                            <span className="document-card__indicator-label">
                              {typeIndicator.label}
                            </span>
                          </div>
                        </article>
                      )
                    })
                  ) : (
                    <div className="documents-empty">No files yet</div>
                  )}
                </div>
              </section>
            </div>

            {pendingUploads.length > 0 ? (
              <div className="upload-dialog-backdrop">
                <section className="upload-dialog" aria-labelledby="upload-dialog-title">
                  <div className="upload-dialog__header">
                    <div>
                      <p className="eyebrow">Upload details</p>
                      <h2 id="upload-dialog-title">Review files</h2>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={handleClearPendingFiles}
                      disabled={isUploading}
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="upload-dialog__files">
                    {pendingUploads.map((upload) => (
                      <div key={upload.key} className="upload-dialog__file-item">
                        <label className="field">
                          <span>Name</span>
                          <input
                            type="text"
                            value={upload.displayName}
                            onChange={(event) =>
                              handlePendingUploadNameChange(upload.key, event.target.value)
                            }
                          />
                        </label>
                        <span className="upload-dialog__file-original">{upload.file.name}</span>
                      </div>
                    ))}
                  </div>

                  <div className="upload-dialog__form">
                    <label className="field">
                      <span>Area</span>
                      <input
                        type="text"
                        list={areaFilterOptions.length > 0 ? 'area-suggestions' : undefined}
                        placeholder="Choose or add an area"
                        value={uploadAreaInput}
                        onChange={(event) => {
                          setUploadAreaInput(event.target.value)
                          setUploadSubjectInput('')
                        }}
                      />
                    </label>

                    <label className="field">
                      <span>Subject/Focus</span>
                      <input
                        type="text"
                        list={
                          uploadSubjectSuggestions.length > 0
                            ? 'upload-subject-suggestions'
                            : undefined
                        }
                        placeholder="Optional"
                        value={uploadSubjectInput}
                        onChange={(event) => setUploadSubjectInput(event.target.value)}
                      />
                    </label>

                    <label className="field">
                      <span>Type</span>
                      <select
                        value={selectedType}
                        onChange={(event) => setSelectedType(event.target.value)}
                      >
                        <option>Notes</option>
                        <option>Lecture</option>
                        <option>Assignment</option>
                        <option>Reading</option>
                      </select>
                    </label>

                    <label className="field">
                      <span>Tags</span>
                      <input
                        type="text"
                        placeholder="Week 4, formulas"
                        value={tagValue}
                        onChange={(event) => setTagValue(event.target.value)}
                      />
                    </label>
                  </div>

                  <div className="upload-dialog__actions">
                    <button
                      className="upload-button"
                      type="button"
                      onClick={handleUploadButtonClick}
                      disabled={isUploading || isAuthenticating}
                    >
                      {isUploading
                        ? 'Uploading...'
                        : `Upload ${pendingUploads.length} file${pendingUploads.length > 1 ? 's' : ''}`}
                    </button>
                  </div>
                </section>
              </div>
            ) : null}
          </section>
        ) : currentView === 'planner' ? (
          <section className="dashboard-panel planner-page" aria-labelledby="planner-title">
            <div className="dashboard-panel__header">
              <div>
                <p className="eyebrow">Planner</p>
                <h1 id="planner-title">{formattedPlannerDate}</h1>
              </div>

              <div className="planner-header-actions">
                <label className="planner-date-field">
                  <span className="sr-only">Planner date</span>
                  <input
                    type="date"
                    value={selectedPlannerDateKey}
                    onChange={(event) => setSelectedPlannerDateKey(event.target.value)}
                  />
                </label>

                <button
                  className="upload-button"
                  type="button"
                  onClick={isPlannerSelecting ? handleTogglePlannerSelection : handleOpenPlannerSetup}
                >
                  {isPlannerSelecting ? 'Cancel' : 'Add session'}
                </button>
              </div>
            </div>

            <div className="panel-filter-bar">
              <div className="filter-row" aria-label="Planner area filters">
                {[ALL_AREAS_FILTER, ...areaFilterOptions].map((areaName) => {
                  const areaTone =
                    areaName === ALL_AREAS_FILTER ? null : getAreaTone(areaName)

                  return (
                    <button
                      key={areaName}
                      className={
                        activePlannerAreaFilter === areaName
                          ? 'filter-chip area-filter-chip is-active'
                          : 'filter-chip area-filter-chip'
                      }
                      type="button"
                      onClick={() => setActivePlannerAreaFilter(areaName)}
                      style={
                        areaTone
                          ? {
                              borderColor: areaTone.border,
                              color: areaTone.text,
                            }
                          : undefined
                      }
                    >
                      {areaName}
                    </button>
                  )
                })}
              </div>
            </div>

            {isPlannerSelecting || plannerSelectionMessage ? (
              <div className="planner-selection-bar">
                <span className="planner-selection-bar__text">
                  {plannerSelectionMessage ||
                    'Click and release the timeline to choose start and end time of the session'}
                </span>
              </div>
            ) : null}

            <div className="planner-timeline-shell">
              <div className="planner-timeline">
                <div className="planner-hours" aria-hidden="true">
                  {plannerHours.map((hour, index) => (
                    <span
                      key={hour.value}
                      className={
                        index === 0
                          ? 'planner-hour is-first'
                          : index === plannerHours.length - 1
                            ? 'planner-hour is-last'
                            : 'planner-hour'
                      }
                      style={{
                        left: `${((hour.value - PLANNER_START_HOUR) / (PLANNER_END_HOUR - PLANNER_START_HOUR)) * 100}%`,
                      }}
                    >
                      {hour.label}
                    </span>
                  ))}
                </div>

                <div
                  ref={plannerTrackRef}
                  className={isPlannerSelecting ? 'planner-track is-selecting' : 'planner-track'}
                  onPointerDown={handlePlannerTrackPointerDown}
                  onPointerMove={handlePlannerTrackPointerMove}
                  onPointerUp={handlePlannerTrackPointerUp}
                >
                  <div
                    className={
                      isPlannerSelecting
                        ? 'planner-track__lane is-selecting'
                        : 'planner-track__lane'
                    }
                  >
                    {plannerHours.map((hour) => (
                      <span
                        key={hour.value}
                        className="planner-gridline"
                        style={{
                          left: `${((hour.value - PLANNER_START_HOUR) / (PLANNER_END_HOUR - PLANNER_START_HOUR)) * 100}%`,
                        }}
                      />
                    ))}
                  </div>

                  {filteredPlannerSessions.map((session) => {
                    const sessionArea = getPlannerSessionArea(session)
                    const areaTone = getAreaTone(sessionArea)
                    const subjectTone = getSubjectTone(sessionArea, session.subject)
                    const sessionNote = normalizeLabel(session.note)
                    const sessionTitle = getPlannerSessionTitle(session)
                    const left = ((session.startMinutes - plannerStartMinutes) / plannerTotalMinutes) * 100
                    const width =
                      ((session.endMinutes - session.startMinutes) / plannerTotalMinutes) * 100

                    return (
                      <article
                        key={session.id}
                        className="planner-session"
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          backgroundColor: subjectTone.background,
                          borderColor: subjectTone.border,
                        }}
                      >
                        <span
                          className="area-pill area-pill--small"
                          style={{
                            backgroundColor: areaTone.background,
                            borderColor: areaTone.border,
                            color: areaTone.text,
                          }}
                        >
                          {sessionArea}
                        </span>
                        <strong>{sessionTitle}</strong>
                        {sessionNote && sessionNote !== sessionTitle ? (
                          <p className="planner-session__note">{sessionNote}</p>
                        ) : null}
                        <span className="planner-session__time">
                          {formatTimelineTime(session.startMinutes)} -{' '}
                          {formatTimelineTime(session.endMinutes)}
                        </span>
                      </article>
                    )
                  })}

                  {plannerSelectionStartMinutes !== null ? (
                    <div
                      className="planner-marker planner-marker--start"
                      style={{
                        left: `${((plannerSelectionStartMinutes - plannerStartMinutes) / plannerTotalMinutes) * 100}%`,
                      }}
                      aria-label={`Start time ${formatTimelineTime(plannerSelectionStartMinutes)}`}
                    >
                      <span className="planner-marker__label">
                        {formatTimelineTime(plannerSelectionStartMinutes)}
                      </span>
                    </div>
                  ) : null}

                  {plannerPreviewMinutes !== null ? (
                    <div
                      className="planner-marker planner-marker--preview"
                      style={{
                        left: `${((plannerPreviewMinutes - plannerStartMinutes) / plannerTotalMinutes) * 100}%`,
                      }}
                      aria-label={`Selected time ${formatTimelineTime(plannerPreviewMinutes)}`}
                    >
                      <span className="planner-marker__label">
                        {formatTimelineTime(plannerPreviewMinutes)}
                      </span>
                    </div>
                  ) : null}

                  {nowMarkerOffset !== null ? (
                    <div
                      className="planner-now"
                      style={{ left: `${nowMarkerOffset}%` }}
                      aria-label={`Current time ${formattedTime}`}
                    >
                      <span className="planner-now__label">{formattedTime}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {activePlannerSession && activePlannerProgress ? (
              <div className="planner-progress">
                <div className="planner-progress__header">
                  <div className="planner-progress__title">
                    <span
                      className="area-pill area-pill--small"
                      style={{
                        backgroundColor: activePlannerSessionTone?.background,
                        borderColor: activePlannerSessionTone?.border,
                        color: activePlannerSessionTone?.text,
                      }}
                    >
                      {activePlannerSessionArea}
                    </span>
                    <strong>{activePlannerSessionTitle}</strong>
                  </div>
                  <span className="planner-progress__time">
                    {activePlannerProgress.remainingMinutes} min left
                  </span>
                </div>
                {activePlannerSessionNote && activePlannerSessionNote !== activePlannerSessionTitle ? (
                  <p className="planner-progress__note">{activePlannerSessionNote}</p>
                ) : null}
                <div className="planner-progress__track" aria-label="Session progress">
                  <span
                    className="planner-progress__fill"
                    style={{
                      width: `${activePlannerProgress.progress}%`,
                      backgroundColor: getSubjectTone(
                        activePlannerSessionArea ?? DEFAULT_AREA_NAME,
                        activePlannerSession.subject,
                      ).border,
                    }}
                  />
                </div>
              </div>
            ) : null}

            {isPlannerSetupOpen ? (
              <div className="upload-dialog-backdrop">
                <section className="upload-dialog planner-setup-dialog" aria-labelledby="planner-setup-title">
                  <div className="upload-dialog__header">
                    <div>
                      <p className="eyebrow">Planner</p>
                      <h2 id="planner-setup-title">Add session</h2>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={handleClosePlannerSetup}
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="upload-dialog__form">
                    <label className="field">
                      <span>Area</span>
                      <input
                        type="text"
                        list={areaFilterOptions.length > 0 ? 'area-suggestions' : undefined}
                        placeholder="Choose or add an area"
                        value={plannerAreaInput}
                        onChange={(event) => {
                          setPlannerAreaInput(event.target.value)
                          setPlannerSubjectInput('')
                        }}
                      />
                    </label>

                    <label className="field">
                      <span>Subject/Focus</span>
                      <input
                        type="text"
                        list={
                          plannerSubjectSuggestions.length > 0
                            ? 'planner-subject-suggestions'
                            : undefined
                        }
                        placeholder="Optional"
                        value={plannerSubjectInput}
                        onChange={(event) => setPlannerSubjectInput(event.target.value)}
                      />
                    </label>

                    <label className="field">
                      <span>Note</span>
                      <textarea
                        rows={3}
                        placeholder="Optional"
                        value={plannerNoteInput}
                        onChange={(event) => setPlannerNoteInput(event.target.value)}
                      />
                    </label>

                    {plannerSetupError ? (
                      <p className="planner-selection-bar__text planner-setup-dialog__error">
                        {plannerSetupError}
                      </p>
                    ) : null}
                  </div>

                  <div className="upload-dialog__actions">
                    <button className="upload-button" type="button" onClick={handleStartPlannerSelection}>
                      Choose time
                    </button>
                  </div>
                </section>
              </div>
            ) : null}

            {plannerReviewSession ? (
              <div className="upload-dialog-backdrop">
                <section
                  className="upload-dialog planner-review-dialog"
                  aria-labelledby="planner-review-title"
                >
                  <div className="upload-dialog__header">
                    <div>
                      <p className="eyebrow">Session review</p>
                      <span
                        className="area-pill"
                        style={{
                          backgroundColor: getAreaTone(getPlannerSessionArea(plannerReviewSession)).background,
                          borderColor: getAreaTone(getPlannerSessionArea(plannerReviewSession)).border,
                          color: getAreaTone(getPlannerSessionArea(plannerReviewSession)).text,
                        }}
                      >
                        {getPlannerSessionArea(plannerReviewSession)}
                      </span>
                      <h2 id="planner-review-title">{getPlannerSessionTitle(plannerReviewSession)}</h2>
                    </div>
                    <span className="planner-review-dialog__time">
                      {formatTimelineTime(plannerReviewSession.startMinutes)} -{' '}
                      {formatTimelineTime(plannerReviewSession.endMinutes)}
                    </span>
                  </div>

                  <div className="upload-dialog__form planner-review-dialog__form">
                    <div className="planner-review-choice-group" role="radiogroup" aria-label="Session outcome">
                      <button
                        className={
                          plannerReviewOutcome === 'completed'
                            ? 'planner-review-choice is-active'
                            : 'planner-review-choice'
                        }
                        type="button"
                        onClick={() => {
                          setPlannerReviewOutcome('completed')
                          setPlannerReviewError('')
                        }}
                      >
                        Completed
                      </button>
                      <button
                        className={
                          plannerReviewOutcome === 'abandoned'
                            ? 'planner-review-choice is-active'
                            : 'planner-review-choice'
                        }
                        type="button"
                        onClick={() => {
                          setPlannerReviewOutcome('abandoned')
                          setPlannerReviewError('')
                        }}
                      >
                        Abandoned
                      </button>
                    </div>

                    {plannerReviewOutcome === 'completed' ? (
                      <label className="field">
                        <span>Focus</span>
                        <div className="planner-review-slider">
                          <input
                            type="range"
                            min="1"
                            max="10"
                            step="1"
                            value={plannerReviewFocusScore}
                            onChange={(event) =>
                              setPlannerReviewFocusScore(Number(event.target.value))
                            }
                          />
                          <strong>{plannerReviewFocusScore}</strong>
                        </div>
                      </label>
                    ) : null}

                    {plannerReviewError ? (
                      <p className="planner-selection-bar__text planner-review-dialog__error">
                        {plannerReviewError}
                      </p>
                    ) : null}
                  </div>

                  <div className="upload-dialog__actions">
                    <button className="upload-button" type="button" onClick={handlePlannerReviewSubmit}>
                      Save review
                    </button>
                  </div>
                </section>
              </div>
            ) : null}
          </section>
        ) : currentView === 'insights' ? (
          <section className="dashboard-panel insights-page" aria-labelledby="insights-title">
            <div className="dashboard-panel__header">
              <div>
                <p className="eyebrow">Insights</p>
                <h1 id="insights-title">Study stats</h1>
              </div>
            </div>

            {reviewedPlannerSessions.length > 0 ? (
              <div className="insights-content">
                <section className="insights-section">
                  <div className="insights-summary-grid">
                    <article className="insight-card insight-card--primary">
                      <span className="insight-card__label">This week</span>
                      <strong className="insight-card__value">
                        {formatDuration(currentWeekStats?.completedMinutes ?? 0)}
                      </strong>
                      <span
                        className={
                          overviewComparisons.minutes > 0
                            ? 'insight-card__change is-positive'
                            : overviewComparisons.minutes < 0
                              ? 'insight-card__change is-negative'
                              : 'insight-card__change'
                        }
                      >
                        {formatMetricDelta(overviewComparisons.minutes, 'm')} vs last week
                      </span>
                    </article>

                    <article className="insight-card">
                      <span className="insight-card__label">Completed</span>
                      <strong className="insight-card__value">
                        {currentWeekStats?.completedCount ?? 0}
                      </strong>
                      <span
                        className={
                          overviewComparisons.sessions > 0
                            ? 'insight-card__change is-positive'
                            : overviewComparisons.sessions < 0
                              ? 'insight-card__change is-negative'
                              : 'insight-card__change'
                        }
                      >
                        {formatMetricDelta(overviewComparisons.sessions)} sessions
                      </span>
                    </article>

                    <article className="insight-card">
                      <span className="insight-card__label">Completion rate</span>
                      <strong className="insight-card__value">
                        {formatPercent(currentWeekStats?.completionRate ?? 0)}
                      </strong>
                      <span
                        className={
                          overviewComparisons.completionRate > 0
                            ? 'insight-card__change is-positive'
                            : overviewComparisons.completionRate < 0
                              ? 'insight-card__change is-negative'
                              : 'insight-card__change'
                        }
                      >
                        {formatMetricDelta(overviewComparisons.completionRate, ' pts')}
                      </span>
                    </article>

                    <article className="insight-card">
                      <span className="insight-card__label">Average focus</span>
                      <strong className="insight-card__value">
                        {currentWeekStats?.averageFocus?.toFixed(1) ?? '0.0'}
                      </strong>
                      <span
                        className={
                          overviewComparisons.focus > 0
                            ? 'insight-card__change is-positive'
                            : overviewComparisons.focus < 0
                              ? 'insight-card__change is-negative'
                              : 'insight-card__change'
                        }
                      >
                        {formatMetricDelta(overviewComparisons.focus)}
                      </span>
                    </article>

                    <article className="insight-card">
                      <span className="insight-card__label">Current streak</span>
                      <strong className="insight-card__value">{currentStreak}</strong>
                      <span className="insight-card__change">
                        Best {bestStreak}
                      </span>
                    </article>
                  </div>
                </section>

                <section className="insights-section">
                  <div className="insights-section__header">
                    <h2>Progression</h2>
                  </div>

                  <div className="insights-two-column">
                    <div className="insight-surface">
                      <div className="weekly-trend">
                        {weekSeries.map((week) => (
                          <div key={week.key} className="weekly-trend__item">
                            <div className="weekly-trend__bar-shell">
                              <span
                                className="weekly-trend__bar"
                                style={{
                                  height: `${Math.max(
                                    (week.completedMinutes / weeklyTrendMaxMinutes) * 100,
                                    week.completedMinutes > 0 ? 8 : 0,
                                  )}%`,
                                }}
                              />
                            </div>
                            <strong>{formatDuration(week.completedMinutes)}</strong>
                            <span>{week.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="insights-stack">
                      <article className="insight-surface">
                        <span className="insight-card__label">Last week</span>
                        <strong className="insight-card__value">
                          {formatDuration(lastWeekStats?.completedMinutes ?? 0)}
                        </strong>
                        <span className="insight-card__change">
                          {lastWeekStats?.completedCount ?? 0} completed
                        </span>
                      </article>

                      <article className="insight-surface">
                        <span className="insight-card__label">All time</span>
                        <strong className="insight-card__value">
                          {formatDuration(allTimeCompletedMinutes)}
                        </strong>
                        <span className="insight-card__change">
                          {completedPlannerSessions.length} completed sessions
                        </span>
                      </article>

                      <article className="insight-surface">
                        <span className="insight-card__label">All-time focus</span>
                        <strong className="insight-card__value">
                          {allTimeFocusAverage?.toFixed(1) ?? '0.0'}
                        </strong>
                        <span className="insight-card__change">
                          {reviewedPlannerSessions.length} reviewed sessions
                        </span>
                      </article>
                    </div>
                  </div>
                </section>

                <section className="insights-section">
                  <div className="insights-section__header">
                    <h2>Consistency</h2>
                  </div>

                  <div className="insights-two-column">
                    <div className="insight-surface">
                      <div className="heatmap-grid">
                        {dailyHeatmap.map((day) => (
                          <div
                            key={day.dateKey}
                            className="heatmap-cell"
                            style={{
                              backgroundColor:
                                day.minutes > 0
                                  ? `rgba(111, 29, 58, ${0.12 + (day.minutes / heatmapMaxMinutes) * 0.36})`
                                  : 'rgba(104, 86, 78, 0.08)',
                            }}
                            title={`${day.dateKey} - ${formatDuration(day.minutes)}`}
                          >
                            <span>{day.dayLabel}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="insights-stack">
                      <article className="insight-surface">
                        <span className="insight-card__label">Days studied</span>
                        <strong className="insight-card__value">
                          {completedDayKeys.length}
                        </strong>
                        <span className="insight-card__change">with completed work</span>
                      </article>

                      <article className="insight-surface">
                        <span className="insight-card__label">Past 28 days</span>
                        <strong className="insight-card__value">
                          {formatDuration(
                            dailyHeatmap.reduce((total, day) => total + day.minutes, 0),
                          )}
                        </strong>
                        <span className="insight-card__change">
                          {dailyHeatmap.filter((day) => day.minutes > 0).length} active days
                        </span>
                      </article>
                    </div>
                  </div>
                </section>

                <section className="insights-section">
                  <div className="insights-section__header">
                    <h2>Allocation</h2>
                  </div>

                  <div className="insights-two-column">
                    <div className="insight-surface">
                      <div className="ranked-list">
                        {areaStats.map((areaStat) => {
                          const areaTone = getAreaTone(areaStat.area)

                          return (
                            <div key={areaStat.area} className="ranked-list__item">
                              <div className="ranked-list__top">
                                <div className="ranked-list__title">
                                  <span
                                    className="area-pill"
                                    style={{
                                      backgroundColor: areaTone.background,
                                      borderColor: areaTone.border,
                                      color: areaTone.text,
                                    }}
                                  >
                                    {areaStat.area}
                                  </span>
                                </div>
                                <strong>{formatDuration(areaStat.minutes)}</strong>
                              </div>
                              <div className="ranked-list__bar-shell">
                                <span
                                  className="ranked-list__bar"
                                  style={{
                                    width: `${(areaStat.minutes / areaStatsMaxMinutes) * 100}%`,
                                  }}
                                />
                              </div>
                              <div className="ranked-list__meta">
                                <span>{areaStat.completedCount} completed</span>
                                <span>{areaStat.abandonedCount} abandoned</span>
                                <span>
                                  Focus {areaStat.averageFocus?.toFixed(1) ?? '0.0'}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    <div className="insight-surface">
                      <div className="ranked-list">
                        {subjectStats.map((subjectStat) => {
                          const areaTone = getAreaTone(subjectStat.area)

                          return (
                            <div
                              key={`${subjectStat.area}-${subjectStat.label}`}
                              className="ranked-list__item"
                            >
                              <div className="ranked-list__top">
                                <div className="ranked-list__title">
                                  <span
                                    className="area-pill area-pill--small"
                                    style={{
                                      backgroundColor: areaTone.background,
                                      borderColor: areaTone.border,
                                      color: areaTone.text,
                                    }}
                                  >
                                    {subjectStat.area}
                                  </span>
                                  <strong>{subjectStat.label}</strong>
                                </div>
                                <strong>{formatDuration(subjectStat.minutes)}</strong>
                              </div>
                              <div className="ranked-list__bar-shell">
                                <span
                                  className="ranked-list__bar"
                                  style={{
                                    width: `${(subjectStat.minutes / subjectStatsMaxMinutes) * 100}%`,
                                  }}
                                />
                              </div>
                              <div className="ranked-list__meta">
                                <span>{subjectStat.completedCount} completed</span>
                                <span>
                                  Focus {subjectStat.averageFocus?.toFixed(1) ?? '0.0'}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="insights-section">
                  <div className="insights-section__header">
                    <h2>Study hours</h2>
                  </div>

                  <div className="insight-surface">
                    <div className="hourly-grid">
                      {hourlyStats.map((hour) => (
                        <div
                          key={hour.hour}
                          className="hourly-grid__cell"
                          style={{
                            backgroundColor:
                              hour.minutes > 0
                                ? `rgba(111, 29, 58, ${0.1 + (hour.minutes / hourlyMaxMinutes) * 0.34})`
                                : 'rgba(104, 86, 78, 0.08)',
                          }}
                        >
                          <strong>{hour.label}</strong>
                          <span>{formatDuration(hour.minutes)}</span>
                          <span>{hour.completedCount} sessions</span>
                          <span>
                            Focus {hour.averageFocus?.toFixed(1) ?? '0.0'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              <div className="insights-empty">
                No session stats yet
              </div>
            )}
          </section>
        ) : (
          <section className="note-page" aria-labelledby="note-page-title">
            <div className="note-page__header">
              <div className="note-page__title">
                <button
                  className="back-button"
                  type="button"
                  onClick={() => setCurrentView('library')}
                >
                  Back to library
                </button>
                <p className="eyebrow">Notes</p>
                <h1 id="note-page-title">New note</h1>
              </div>

              <button className="upload-button" type="button">
                Save draft
              </button>
            </div>

            <div className="note-page__meta">
              <label className="field">
                <span>Title</span>
                <input type="text" placeholder="Lecture recap" />
              </label>

              <label className="field">
                <span>Area</span>
                <input
                  type="text"
                  list={areaFilterOptions.length > 0 ? 'area-suggestions' : undefined}
                  placeholder="Choose or add an area"
                  value={noteAreaInput}
                  onChange={(event) => {
                    setNoteAreaInput(event.target.value)
                    setNoteSubjectInput('')
                  }}
                />
              </label>

              <label className="field">
                <span>Subject/Focus</span>
                <input
                  type="text"
                  list={
                    noteSubjectSuggestions.length > 0
                      ? 'note-subject-suggestions'
                      : undefined
                  }
                  placeholder="Optional"
                  value={noteSubjectInput}
                  onChange={(event) => setNoteSubjectInput(event.target.value)}
                />
              </label>

              <label className="field">
                <span>Tags</span>
                <input type="text" placeholder="Week 5, summary" />
              </label>
            </div>

            <label className="field note-page__editor">
              <span>Note</span>
              <textarea
                rows={20}
                placeholder="Write key ideas, formulas, reminders, and questions here"
              />
            </label>
          </section>
        )}

        {areaFilterOptions.length > 0 ? (
          <datalist id="area-suggestions">
            {areaFilterOptions.map((areaName) => (
              <option key={areaName} value={areaName} />
            ))}
          </datalist>
        ) : null}

        {uploadSubjectSuggestions.length > 0 ? (
          <datalist id="upload-subject-suggestions">
            {uploadSubjectSuggestions.map((subject) => (
              <option key={`upload-${subject}`} value={subject} />
            ))}
          </datalist>
        ) : null}

        {plannerSubjectSuggestions.length > 0 ? (
          <datalist id="planner-subject-suggestions">
            {plannerSubjectSuggestions.map((subject) => (
              <option key={`planner-${subject}`} value={subject} />
            ))}
          </datalist>
        ) : null}

        {noteSubjectSuggestions.length > 0 ? (
          <datalist id="note-subject-suggestions">
            {noteSubjectSuggestions.map((subject) => (
              <option key={`note-${subject}`} value={subject} />
            ))}
          </datalist>
        ) : null}
      </main>
    </div>
  )
}

export default App
