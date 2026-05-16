import type { ChangeEvent, DragEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type CurrentView = 'library' | 'note'

type DocumentItem = {
  id?: string
  title: string
  subject: string
  type: string
  meta: string
  tags: string[]
  link?: string
}

type TokenResponse = {
  access_token?: string
  error?: string
}

type TokenClient = {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void
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
          }) => TokenClient
        }
      }
    }
  }
}

const GOOGLE_CLIENT_ID =
  '347804918623-t28vi7icqkvqr7f8geloto0ncogj13up.apps.googleusercontent.com'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const DRIVE_FOLDER_NAME = 'StudieRommet'
const DRIVE_AUTO_CONNECT_KEY = 'studierommet-drive-auto-connect'

const navItems = ['Dashboard', 'Library', 'Planner', 'Sessions', 'Insights']

const subjects = [
  { name: 'Microeconomics', count: 18 },
  { name: 'Mathematics', count: 24 },
  { name: 'Accounting', count: 13 },
  { name: 'Management', count: 11 },
  { name: 'Statistics', count: 16 },
]

const filters = ['All', 'Notes', 'Lectures', 'Assignments', 'Readings']

const initialDocuments: DocumentItem[] = []

function getNow() {
  return new Date()
}

function parseTags(tagValue: string) {
  return tagValue
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
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
  subject: string,
  type: string,
  tags: string[],
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
            subject,
            type,
            tags: tags.join(', '),
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

function formatDriveMeta(createdTime?: string) {
  if (!createdTime) {
    return 'Saved in Google Drive'
  }

  return `Uploaded ${new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  }).format(new Date(createdTime))}`
}

function App() {
  const [now, setNow] = useState(getNow)
  const [currentView, setCurrentView] = useState<CurrentView>('library')
  const [documents, setDocuments] = useState(initialDocuments)
  const [selectedSubject, setSelectedSubject] = useState(subjects[0].name)
  const [selectedType, setSelectedType] = useState('Notes')
  const [tagValue, setTagValue] = useState('')
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState(
    'Connect Google Drive to upload files across devices.',
  )
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragActive, setIsDragActive] = useState(false)

  const tokenClientRef = useRef<TokenClient | null>(null)
  const accessTokenRef = useRef<string | null>(null)
  const pendingFilesRef = useRef<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const authModeRef = useRef<'manual' | 'auto'>('manual')

  useEffect(() => {
    accessTokenRef.current = accessToken
  }, [accessToken])

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
            subject?: string
            type?: string
            tags?: string
          }
        }>
      }>(
        token,
        `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,webViewLink,createdTime,appProperties)&orderBy=createdTime desc`,
      )

      const nextDocuments = response.files.map((file) => ({
        id: file.id,
        title: file.name,
        subject: file.appProperties?.subject || 'Unsorted',
        type: file.appProperties?.type || 'File',
        meta: formatDriveMeta(file.createdTime),
        tags: parseTags(file.appProperties?.tags || ''),
        link: file.webViewLink,
      }))

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

  const uploadFiles = useCallback(async (
    files: File[],
    tokenOverride?: string,
  ): Promise<void> => {
    const token = tokenOverride ?? accessTokenRef.current

    if (!token || files.length === 0) {
      return
    }

    try {
      setIsUploading(true)
      setStatusMessage(
        `Uploading ${files.length} file${files.length > 1 ? 's' : ''} to Google Drive...`,
      )

      const folderId = await ensureDriveFolder(token)
      const tags = parseTags(tagValue)

      const uploadedDocuments = await Promise.all(
        files.map(async (file) => {
          const uploadedFile = await uploadFileToDrive(
            token,
            file,
            folderId,
            selectedSubject,
            selectedType,
            tags,
          )

          return {
            id: uploadedFile.id,
            title: uploadedFile.name,
            subject: selectedSubject,
            type: selectedType,
            meta: 'Uploaded just now',
            tags,
            link: uploadedFile.webViewLink,
          } satisfies DocumentItem
        }),
      )

      setDocuments((currentDocuments) => [...uploadedDocuments, ...currentDocuments])
      pendingFilesRef.current = []
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
  }, [loadDriveDocuments, selectedSubject, selectedType, tagValue])

  useEffect(() => {
    const initializeGoogle = async () => {
      try {
        await loadGoogleIdentityScript()

        if (!window.google?.accounts?.oauth2) {
          throw new Error('Google Identity Services did not load correctly.')
        }

        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: DRIVE_SCOPE,
          callback: (response) => {
            setIsAuthenticating(false)

            if (response.error || !response.access_token) {
              if (authModeRef.current === 'manual') {
                setStatusMessage('Google Drive sign-in did not complete.')
              } else {
                setStatusMessage('Connect Google Drive to upload files across devices.')
              }
              return
            }

            setAccessToken(response.access_token)
            localStorage.setItem(DRIVE_AUTO_CONNECT_KEY, 'true')
            void loadDriveDocuments(response.access_token)

            if (pendingFilesRef.current.length > 0) {
              void uploadFiles(pendingFilesRef.current, response.access_token)
            }
          },
        })

        if (localStorage.getItem(DRIVE_AUTO_CONNECT_KEY) === 'true') {
          authModeRef.current = 'auto'
          setIsAuthenticating(true)
          setStatusMessage('Reconnecting to Google Drive...')
          tokenClientRef.current.requestAccessToken({
            prompt: '',
          })
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
  }, [loadDriveDocuments, uploadFiles])

  const connectDrive = () => {
    if (!tokenClientRef.current) {
      setStatusMessage('Google Drive sign-in is still loading.')
      return
    }

    authModeRef.current = 'manual'
    setIsAuthenticating(true)
    setStatusMessage('Connecting to Google Drive...')
    tokenClientRef.current.requestAccessToken({
      prompt: accessTokenRef.current ? '' : 'consent',
    })
  }

  const handleIncomingFiles = (files: File[]) => {
    if (files.length === 0) {
      return
    }

    if (accessTokenRef.current) {
      void uploadFiles(files)
      return
    }

    pendingFilesRef.current = files
    connectDrive()
  }

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const incomingFiles = Array.from(event.target.files ?? [])
    handleIncomingFiles(incomingFiles)
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const droppedFiles = Array.from(event.dataTransfer.files)
    handleIncomingFiles(droppedFiles)
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

    fileInputRef.current?.click()
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

  const uploadButtonLabel = accessToken ? 'Upload' : 'Connect Drive'

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="StudieRommet home">
          StudieRommet
        </a>

        <nav className="topnav" aria-label="Primary">
          {navItems.map((item) => (
            <a
              key={item}
              className={item === 'Library' ? 'nav-link is-active' : 'nav-link'}
              href="/"
            >
              {item}
            </a>
          ))}
        </nav>

        <div className="topbar-right">
          <button
            className="secondary-button"
            type="button"
            onClick={() => setCurrentView('note')}
          >
            New note
          </button>

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
        {currentView === 'library' ? (
          <section className="dashboard-panel" aria-labelledby="dashboard-title">
            <div className="dashboard-panel__header">
              <div>
                <p className="eyebrow">Library</p>
                <h1 id="dashboard-title">Notes and documents</h1>
              </div>
            </div>

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

                <div className="upload-meta">
                  <label className="field">
                    <span>Subject</span>
                    <select
                      value={selectedSubject}
                      onChange={(event) => setSelectedSubject(event.target.value)}
                    >
                      {subjects.map((subject) => (
                        <option key={subject.name} value={subject.name}>
                          {subject.name}
                        </option>
                      ))}
                    </select>
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
              </section>

              <section className="documents-panel" aria-labelledby="document-list-title">
                <div className="documents-panel__header">
                  <h2 id="document-list-title">Recent documents</h2>
                </div>

                <div className="document-list">
                  {documents.length > 0 ? (
                    documents.map((document) => (
                      <article key={`${document.title}-${document.meta}`} className="document-card">
                        <div className="document-card__top">
                          <div>
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
                            <p>{document.subject}</p>
                          </div>
                          <div className="document-card__actions">
                            <span className="document-type">{document.type}</span>
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
                      </article>
                    ))
                  ) : (
                    <div className="documents-empty">No files yet</div>
                  )}
                </div>
              </section>
            </div>
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
                <span>Subject</span>
                <select defaultValue="Management">
                  {subjects.map((subject) => (
                    <option key={subject.name} value={subject.name}>
                      {subject.name}
                    </option>
                  ))}
                </select>
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
      </main>
    </div>
  )
}

export default App
