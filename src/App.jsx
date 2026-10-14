import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_ROOT = import.meta.env.VITE_API_ROOT || `http://${window.location.hostname}:5000`
const API_URL = import.meta.env.VITE_API_URL || `${API_ROOT}/todos`
const AUTH_URL = `${API_ROOT}/auth`

const PRIORITIES = {
  high: '높음',
  medium: '보통',
  low: '낮음',
}

const PRIORITY_ORDER = {
  high: 3,
  medium: 2,
  low: 1,
}

const emptyForm = {
  content: '',
  deadline: '',
  priority: '',
}

const pageDate = new Date()
const pageTime = pageDate.getTime()
const todayStart = new Date(
  pageDate.getFullYear(),
  pageDate.getMonth(),
  pageDate.getDate(),
).getTime()

function getCurrentTimestamp() {
  return new Date().toISOString()
}

async function request(url = API_URL, options = {}) {
  let response

  try {
    response = await fetch(url, {
      credentials: 'include',
      ...options,
    })
  } catch (cause) {
    const error = new Error(
      '백엔드 서버에 연결할 수 없습니다. localhost:5000 서버를 확인해 주세요.',
      { cause },
    )
    error.isConnectionError = true
    throw error
  }

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const error = new Error(data?.message || '요청을 처리하지 못했습니다.')
    error.status = response.status
    throw error
  }

  return data
}

function normalizeTodo(todo) {
  return {
    ...todo,
    completed: Boolean(todo.completed),
    deadline: todo.deadline || null,
    priority: PRIORITIES[todo.priority] ? todo.priority : null,
  }
}

function parseDeadline(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function toDateTimeLocal(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function getDeadlineState(todo) {
  if (!todo.deadline) return 'none'

  const deadline = new Date(todo.deadline)
  if (Number.isNaN(deadline.getTime())) return 'none'
  if (!todo.completed && deadline.getTime() < pageTime) return 'overdue'

  const dueDay = new Date(
    deadline.getFullYear(),
    deadline.getMonth(),
    deadline.getDate(),
  ).getTime()
  const difference = Math.round((dueDay - todayStart) / 86400000)

  if (difference === 0) return 'today'
  if (difference === 1) return 'tomorrow'
  return 'default'
}

function formatDeadline(todo) {
  if (!todo.deadline) return '마감 없음'

  const deadline = new Date(todo.deadline)
  if (Number.isNaN(deadline.getTime())) return '마감 없음'

  const state = getDeadlineState(todo)
  const time = new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(deadline)

  if (state === 'today' || state === 'overdue') return `오늘 ${time}`
  if (state === 'tomorrow') return `내일 ${time}`

  return `마감 ${new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(deadline)}`
}

function formatCreatedAt(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function sortTodos(todos, sortMode) {
  return [...todos].sort((a, b) => {
    if (a.completed !== b.completed) {
      return Number(a.completed) - Number(b.completed)
    }

    const priorityDifference =
      (PRIORITY_ORDER[b.priority] ?? 0) - (PRIORITY_ORDER[a.priority] ?? 0)
    const firstDeadline = a.deadline
      ? new Date(a.deadline).getTime()
      : Number.POSITIVE_INFINITY
    const secondDeadline = b.deadline
      ? new Date(b.deadline).getTime()
      : Number.POSITIVE_INFINITY
    const deadlineDifference = firstDeadline - secondDeadline
    const newestDifference =
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()

    if (sortMode === 'deadline') {
      return deadlineDifference || priorityDifference || newestDifference
    }
    if (sortMode === 'priority') {
      return priorityDifference || deadlineDifference || newestDifference
    }
    if (sortMode === 'newest') return newestDifference
    return priorityDifference || deadlineDifference || newestDifference
  })
}

function TodoApp({ user, onLogout, onDeleteAccount }) {
  const [todos, setTodos] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [filter, setFilter] = useState('all')
  const [deadlineFilter, setDeadlineFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState('recommended')
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [connected, setConnected] = useState(true)
  const [lastSync, setLastSync] = useState('')
  const [message, setMessage] = useState(null)
  const [undoTodos, setUndoTodos] = useState([])
  const messageTimer = useRef(null)
  const undoTimer = useRef(null)

  function showMessage(text, type = 'success') {
    clearTimeout(messageTimer.current)
    setMessage({ text, type })

    if (type === 'success') {
      messageTimer.current = setTimeout(() => setMessage(null), 2400)
    }
  }

  function handleError(error) {
    setConnected(!error.isConnectionError)
    showMessage(error.message, 'error')
  }

  useEffect(() => {
    const controller = new AbortController()

    request(API_URL, { signal: controller.signal })
      .then((data) => {
        setTodos(Array.isArray(data) ? data.map(normalizeTodo) : [])
        setConnected(true)
        setLastSync(getCurrentTimestamp())
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setConnected(!error.isConnectionError)
          setMessage({ text: error.message, type: 'error' })
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [])

  const counts = useMemo(() => {
    const completed = todos.filter((todo) => todo.completed).length
    const overdue = todos.filter(
      (todo) => !todo.completed && getDeadlineState(todo) === 'overdue',
    ).length
    const today = todos.filter(
      (todo) => !todo.completed && getDeadlineState(todo) === 'today',
    ).length

    return {
      all: todos.length,
      active: todos.length - completed,
      completed,
      overdue,
      today,
    }
  }, [todos])

  const visibleTodos = useMemo(() => {
    let filtered = todos

    if (filter === 'active') filtered = filtered.filter((todo) => !todo.completed)
    if (filter === 'completed') filtered = filtered.filter((todo) => todo.completed)
    if (deadlineFilter !== 'all') {
      filtered = filtered.filter(
        (todo) => !todo.completed && getDeadlineState(todo) === deadlineFilter,
      )
    }

    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('ko-KR')
    if (normalizedQuery) {
      filtered = filtered.filter((todo) =>
        todo.content.toLocaleLowerCase('ko-KR').includes(normalizedQuery),
      )
    }

    return sortTodos(filtered, sortMode)
  }, [deadlineFilter, filter, searchQuery, sortMode, todos])

  async function refreshTodos() {
    try {
      setRefreshing(true)
      const data = await request()
      setTodos(Array.isArray(data) ? data.map(normalizeTodo) : [])
      setConnected(true)
      setLastSync(getCurrentTimestamp())
      showMessage('최신 목록으로 새로고침했습니다.')
    } catch (error) {
      handleError(error)
    } finally {
      setRefreshing(false)
    }
  }

  async function addTodo(event) {
    event.preventDefault()
    const content = form.content.trim()
    const deadline = parseDeadline(form.deadline)

    if (!content) {
      showMessage('할 일 내용을 입력해 주세요.', 'error')
      return
    }
    if (deadline === undefined) {
      showMessage('마감기한을 올바르게 입력해 주세요.', 'error')
      return
    }

    try {
      setSubmitting(true)
      const newTodo = await request(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          deadline,
          priority: form.priority || null,
        }),
      })
      setTodos((current) => [normalizeTodo(newTodo), ...current])
      setForm(emptyForm)
      setConnected(true)
      setFilter('all')
      setDeadlineFilter('all')
      showMessage('새 할 일이 추가되었습니다.')
    } catch (error) {
      handleError(error)
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleTodo(todo) {
    try {
      setBusyId(todo._id)
      const updated = await request(`${API_URL}/${todo._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: todo.content,
          deadline: todo.deadline,
          priority: todo.priority,
          completed: !todo.completed,
        }),
      })
      setTodos((current) =>
        current.map((item) =>
          item._id === todo._id ? normalizeTodo(updated) : item,
        ),
      )
      setConnected(true)
      showMessage(todo.completed ? '할 일을 다시 진행 중으로 변경했습니다.' : '할 일을 완료했습니다.')
    } catch (error) {
      handleError(error)
    } finally {
      setBusyId(null)
    }
  }

  function startEditing(todo) {
    setEditingId(todo._id)
    setEditForm({
      content: todo.content,
      deadline: toDateTimeLocal(todo.deadline),
      priority: todo.priority || '',
    })
    setMessage(null)
  }

  async function saveTodo(todo) {
    const content = editForm.content.trim()
    const deadline = parseDeadline(editForm.deadline)

    if (!content) {
      showMessage('할 일 내용을 입력해 주세요.', 'error')
      return
    }
    if (deadline === undefined) {
      showMessage('마감기한을 올바르게 입력해 주세요.', 'error')
      return
    }

    try {
      setBusyId(todo._id)
      const updated = await request(`${API_URL}/${todo._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          deadline,
          priority: editForm.priority || null,
          completed: todo.completed,
        }),
      })
      setTodos((current) =>
        current.map((item) =>
          item._id === todo._id ? normalizeTodo(updated) : item,
        ),
      )
      setEditingId(null)
      setConnected(true)
      showMessage('할 일이 수정되었습니다.')
    } catch (error) {
      handleError(error)
    } finally {
      setBusyId(null)
    }
  }

  function showUndo(deletedTodos, text) {
    clearTimeout(undoTimer.current)
    setUndoTodos(deletedTodos.map(normalizeTodo))
    showMessage(text)
    undoTimer.current = setTimeout(() => setUndoTodos([]), 6000)
  }

  async function deleteTodo(todo) {
    try {
      setBusyId(todo._id)
      const deleted = await request(`${API_URL}/${todo._id}`, { method: 'DELETE' })
      setTodos((current) => current.filter((item) => item._id !== todo._id))
      setConnected(true)
      showUndo([deleted], '할 일을 삭제했습니다.')
    } catch (error) {
      handleError(error)
    } finally {
      setBusyId(null)
    }
  }

  async function deleteCompleted() {
    const completedTodos = todos.filter((todo) => todo.completed)
    if (!completedTodos.length) return
    if (!window.confirm(`완료한 할 일 ${completedTodos.length}개를 모두 삭제할까요?`)) return

    try {
      setBusyId('completed')
      const results = await Promise.all(
        completedTodos.map((todo) =>
          request(`${API_URL}/${todo._id}`, { method: 'DELETE' }),
        ),
      )
      const deletedIds = new Set(results.map((todo) => todo._id))
      setTodos((current) => current.filter((todo) => !deletedIds.has(todo._id)))
      setConnected(true)
      showUndo(results, `완료한 할 일 ${results.length}개를 삭제했습니다.`)
    } catch (error) {
      handleError(error)
      await refreshTodos()
    } finally {
      setBusyId(null)
    }
  }

  async function undoDelete() {
    if (!undoTodos.length) return

    try {
      setBusyId('undo')
      clearTimeout(undoTimer.current)
      const restored = []

      for (const todo of undoTodos) {
        let restoredTodo = await request(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: todo.content,
            deadline: todo.deadline,
            priority: todo.priority,
          }),
        })

        if (todo.completed) {
          restoredTodo = await request(`${API_URL}/${restoredTodo._id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: todo.content,
              deadline: todo.deadline,
              priority: todo.priority,
              completed: true,
            }),
          })
        }
        restored.push(normalizeTodo(restoredTodo))
      }

      setTodos((current) => [...restored, ...current])
      setUndoTodos([])
      setConnected(true)
      showMessage('삭제한 할 일을 복원했습니다.')
    } catch (error) {
      handleError(error)
    } finally {
      setBusyId(null)
    }
  }

  const todayLabel = new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(pageDate)

  const lastSyncLabel = lastSync
    ? `마지막 업데이트 ${new Intl.DateTimeFormat('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(lastSync))}`
    : '업데이트 전'

  let emptyMessage = '아직 등록된 할 일이 없습니다. 첫 할 일을 추가해 보세요.'
  if (todos.length && searchQuery.trim()) emptyMessage = `“${searchQuery.trim()}” 검색 결과가 없습니다.`
  else if (todos.length && deadlineFilter === 'overdue') emptyMessage = '기한이 지난 할 일이 없습니다.'
  else if (todos.length && deadlineFilter === 'today') emptyMessage = '오늘 마감인 할 일이 없습니다.'
  else if (todos.length && filter === 'completed') emptyMessage = '완료한 일이 없습니다.'
  else if (todos.length && filter === 'active') emptyMessage = '진행 중인 일이 없습니다.'

  return (
    <main className="todo-app">
      <header className="app-header">
        <div>
          <p className="eyebrow">DAILY PLANNER</p>
          <h1>오늘의 할 일</h1>
          <p className="subtitle">중요한 일부터 차근차근 완료해 보세요.</p>
        </div>
        <div className="header-account">
          <time className="today" dateTime={pageDate.toISOString().slice(0, 10)}>{todayLabel}</time>
          <div className="account-actions">
            <span className="user-name"><strong>{user.name}</strong>님</span>
            <button type="button" className="account-button" onClick={onLogout}>로그아웃</button>
            <button type="button" className="account-button danger" onClick={onDeleteAccount}>회원탈퇴</button>
          </div>
        </div>
      </header>

      {!connected && (
        <div className="connection-banner" role="alert">
          <span>백엔드 서버와 연결이 끊겼습니다.</span>
          <button type="button" onClick={refreshTodos} disabled={refreshing}>
            {refreshing ? '연결 중…' : '다시 연결'}
          </button>
        </div>
      )}

      <section className="composer" aria-labelledby="composer-title">
        <div className="section-heading">
          <div>
            <p className="section-label">새로운 일정</p>
            <h2 id="composer-title">무엇을 해야 하나요?</h2>
          </div>
        </div>

        <form className="todo-form" onSubmit={addTodo}>
          <label className="task-field" htmlFor="todo-input">
            <span>할 일</span>
            <input
              id="todo-input"
              type="text"
              value={form.content}
              onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
              placeholder="예: 발표 자료 마무리하기"
              autoComplete="off"
              maxLength="200"
              required
              disabled={submitting}
            />
          </label>

          <div className="form-options">
            <label htmlFor="deadline-input">
              <span>마감기한 <strong className="optional-label">선택</strong></span>
              <input
                id="deadline-input"
                type="datetime-local"
                value={form.deadline}
                onChange={(event) => setForm((current) => ({ ...current, deadline: event.target.value }))}
                disabled={submitting}
              />
            </label>

            <label htmlFor="priority-input">
              <span>우선순위 <strong className="optional-label">선택</strong></span>
              <select
                id="priority-input"
                value={form.priority}
                onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
                disabled={submitting}
              >
                <option value="">선택 안 함</option>
                <option value="high">높음</option>
                <option value="medium">보통</option>
                <option value="low">낮음</option>
              </select>
            </label>
          </div>

          <button type="submit" className="add-button" disabled={submitting}>
            <span aria-hidden="true">＋</span>
            <span>{submitting ? '추가 중…' : '할 일 추가'}</span>
          </button>
        </form>
      </section>

      <section className="list-section" aria-labelledby="list-title">
        <div className="list-header">
          <div className="list-title-group">
            <h2 id="list-title">할 일 목록</h2>
            <p className="list-help">체크하면 완료로 표시됩니다.</p>
          </div>
          <div className="summary" aria-label="할 일 요약">
            <time className="last-sync" dateTime={lastSync}>{lastSyncLabel}</time>
            <button
              type="button"
              className={`sync-button ${refreshing ? 'syncing' : ''}`}
              onClick={refreshTodos}
              disabled={refreshing || editingId !== null}
            >
              <span className="sync-icon" aria-hidden="true">↻</span>
              <span>{refreshing ? '불러오는 중…' : '새로고침'}</span>
            </button>
          </div>
        </div>

        <div className="filter-tabs" role="group" aria-label="할 일 필터">
          {[
            ['all', '전체'],
            ['active', '진행 중'],
            ['completed', '완료'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`filter-button ${filter === value ? 'active' : ''}`}
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value)
                setDeadlineFilter('all')
              }}
            >
              {label} <span className="filter-count">{counts[value]}</span>
            </button>
          ))}
          {filter === 'completed' && counts.completed > 0 && (
            <button
              type="button"
              className="clear-completed-button"
              onClick={deleteCompleted}
              disabled={busyId === 'completed'}
            >
              {busyId === 'completed' ? '삭제 중…' : `완료 ${counts.completed}개 삭제`}
            </button>
          )}
        </div>

        {(counts.overdue > 0 || counts.today > 0) && (
          <div className="deadline-summary" role="group" aria-label="마감기한 필터">
            {counts.overdue > 0 && (
              <button
                type="button"
                className={`deadline-summary-button overdue-summary ${deadlineFilter === 'overdue' ? 'active' : ''}`}
                aria-pressed={deadlineFilter === 'overdue'}
                onClick={() => {
                  setDeadlineFilter((current) => current === 'overdue' ? 'all' : 'overdue')
                  setFilter('active')
                }}
              >
                기한 초과 <strong>{counts.overdue}</strong>개
              </button>
            )}
            {counts.today > 0 && (
              <button
                type="button"
                className={`deadline-summary-button today-summary ${deadlineFilter === 'today' ? 'active' : ''}`}
                aria-pressed={deadlineFilter === 'today'}
                onClick={() => {
                  setDeadlineFilter((current) => current === 'today' ? 'all' : 'today')
                  setFilter('active')
                }}
              >
                오늘 마감 <strong>{counts.today}</strong>개
              </button>
            )}
          </div>
        )}

        <div className="list-tools">
          <div className="search-field">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <label className="sr-only" htmlFor="search-input">할 일 검색</label>
            <input
              id="search-input"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="할 일 검색"
              autoComplete="off"
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-button"
                onClick={() => setSearchQuery('')}
                aria-label="검색어 지우기"
              >
                지우기
              </button>
            )}
          </div>
          <label className="sort-field" htmlFor="sort-select">
            <span>정렬</span>
            <select id="sort-select" value={sortMode} onChange={(event) => setSortMode(event.target.value)}>
              <option value="recommended">추천순</option>
              <option value="deadline">마감순</option>
              <option value="priority">우선순위순</option>
              <option value="newest">최신순</option>
            </select>
          </label>
        </div>

        {loading && <p className="status loading" role="status">할 일을 불러오는 중...</p>}
        {!loading && message && (
          <p className={`status ${message.type === 'error' ? 'error' : ''}`} role="status">
            {message.text}
          </p>
        )}
        {!loading && !visibleTodos.length && !message && (
          <p className="status empty-state" role="status">{emptyMessage}</p>
        )}

        {!loading && visibleTodos.length > 0 && (
          <ul className="todo-list">
            {visibleTodos.map((todo) => {
              const deadlineState = getDeadlineState(todo)
              const isBusy = busyId === todo._id
              const itemClassName = [
                'todo-item',
                todo.priority ? `priority-${todo.priority}` : '',
                todo.completed ? 'completed' : '',
                deadlineState === 'overdue' ? 'overdue' : '',
              ].filter(Boolean).join(' ')

              return (
                <li className={itemClassName} key={todo._id}>
                  {editingId === todo._id ? (
                    <>
                      <div className="edit-fields">
                        <input
                          className="edit-input"
                          value={editForm.content}
                          onChange={(event) => setEditForm((current) => ({ ...current, content: event.target.value }))}
                          aria-label="할 일 내용 수정"
                          maxLength="200"
                          autoFocus
                          disabled={isBusy}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') saveTodo(todo)
                            if (event.key === 'Escape') setEditingId(null)
                          }}
                        />
                        <div className="edit-options">
                          <label>
                            <span>마감기한 (선택)</span>
                            <input
                              type="datetime-local"
                              value={editForm.deadline}
                              onChange={(event) => setEditForm((current) => ({ ...current, deadline: event.target.value }))}
                              disabled={isBusy}
                            />
                          </label>
                          <label>
                            <span>우선순위</span>
                            <select
                              value={editForm.priority}
                              onChange={(event) => setEditForm((current) => ({ ...current, priority: event.target.value }))}
                              disabled={isBusy}
                            >
                              <option value="">선택 안 함</option>
                              <option value="high">높음</option>
                              <option value="medium">보통</option>
                              <option value="low">낮음</option>
                            </select>
                          </label>
                        </div>
                      </div>
                      <div className="item-actions">
                        <button type="button" className="save-button" onClick={() => saveTodo(todo)} disabled={isBusy}>
                          {isBusy ? '저장 중…' : '저장'}
                        </button>
                        <button type="button" className="edit-button" onClick={() => setEditingId(null)} disabled={isBusy}>취소</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="todo-main">
                        <label className="todo-title-row">
                          <input
                            type="checkbox"
                            checked={todo.completed}
                            onChange={() => toggleTodo(todo)}
                            disabled={isBusy}
                            aria-label={`${todo.content} 완료 여부`}
                          />
                          <span className="todo-content">{todo.content}</span>
                          <span className={`todo-status-badge ${todo.completed ? 'status-completed' : 'status-active'}`}>
                            {todo.completed ? '완료' : '진행 중'}
                          </span>
                        </label>
                        <div className="todo-meta">
                          <span className="priority-badge">
                            {todo.priority ? PRIORITIES[todo.priority] : '우선순위 없음'}
                          </span>
                          <span className={`deadline-text deadline-${deadlineState}`}>
                            {formatDeadline(todo)}{deadlineState === 'overdue' ? ' · 기한 지남' : ''}
                          </span>
                        </div>
                        {todo.createdAt && (
                          <time className="todo-created-at" dateTime={todo.createdAt}>
                            {formatCreatedAt(todo.createdAt)}
                          </time>
                        )}
                      </div>
                      <div className="item-actions">
                        <button type="button" className="edit-button" onClick={() => startEditing(todo)} disabled={isBusy}>수정</button>
                        <button type="button" className="delete-button" onClick={() => deleteTodo(todo)} disabled={isBusy}>
                          {isBusy ? '삭제 중…' : '삭제'}
                        </button>
                      </div>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {undoTodos.length > 0 && (
        <div className="undo-toast" role="status" aria-live="polite">
          <span>{undoTodos.length === 1 ? '할 일을 삭제했습니다.' : `할 일 ${undoTodos.length}개를 삭제했습니다.`}</span>
          <button type="button" onClick={undoDelete} disabled={busyId === 'undo'}>
            {busyId === 'undo' ? '복원 중…' : '실행 취소'}
          </button>
        </div>
      )}
    </main>
  )
}

function AuthScreen({ onAuthenticated, initialError = '' }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    passwordConfirm: '',
  })
  const [error, setError] = useState(initialError)
  const [submitting, setSubmitting] = useState(false)

  function changeMode(nextMode) {
    setMode(nextMode)
    setError('')
    setForm((current) => ({
      ...current,
      name: '',
      password: '',
      passwordConfirm: '',
    }))
  }

  async function submit(event) {
    event.preventDefault()

    if (mode === 'signup' && form.password !== form.passwordConfirm) {
      setError('비밀번호 확인이 일치하지 않습니다.')
      return
    }

    try {
      setSubmitting(true)
      setError('')
      const data = await request(`${AUTH_URL}/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
        }),
      })
      onAuthenticated(data.user)
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <p className="eyebrow">DAILY PLANNER</p>
          <h1 id="auth-title">오늘의 할 일</h1>
          <p>나만의 일정과 기록을 안전하게 관리하세요.</p>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="회원 메뉴">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => changeMode('login')}
            role="tab"
            aria-selected={mode === 'login'}
          >
            로그인
          </button>
          <button
            type="button"
            className={mode === 'signup' ? 'active' : ''}
            onClick={() => changeMode('signup')}
            role="tab"
            aria-selected={mode === 'signup'}
          >
            회원가입
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === 'signup' && (
            <label>
              <span>이름</span>
              <input
                type="text"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="이름을 입력해 주세요"
                minLength="2"
                maxLength="30"
                autoComplete="name"
                required
                disabled={submitting}
              />
            </label>
          )}

          <label>
            <span>이메일</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="email@example.com"
              autoComplete="email"
              required
              disabled={submitting}
            />
          </label>

          <label>
            <span>비밀번호</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              placeholder="8자 이상 입력해 주세요"
              minLength="8"
              maxLength="72"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              disabled={submitting}
            />
          </label>

          {mode === 'signup' && (
            <label>
              <span>비밀번호 확인</span>
              <input
                type="password"
                value={form.passwordConfirm}
                onChange={(event) => setForm((current) => ({ ...current, passwordConfirm: event.target.value }))}
                placeholder="비밀번호를 다시 입력해 주세요"
                minLength="8"
                maxLength="72"
                autoComplete="new-password"
                required
                disabled={submitting}
              />
            </label>
          )}

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting
              ? mode === 'login' ? '로그인 중…' : '가입 중…'
              : mode === 'login' ? '로그인' : '회원가입'}
          </button>
        </form>

        <p className="auth-help">
          {mode === 'login' ? '계정이 없으신가요?' : '이미 계정이 있으신가요?'}{' '}
          <button type="button" onClick={() => changeMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? '회원가입' : '로그인'}
          </button>
        </p>
      </section>
    </main>
  )
}

function App() {
  const [user, setUser] = useState(undefined)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    request(`${AUTH_URL}/me`, { signal: controller.signal })
      .then((data) => setUser(data.user))
      .catch((error) => {
        if (error.name === 'AbortError') return
        if (error.status !== 401) setAuthError(error.message)
        setUser(null)
      })

    return () => controller.abort()
  }, [])

  async function logout() {
    try {
      await request(`${AUTH_URL}/logout`, { method: 'POST' })
      setUser(null)
      setAuthError('')
    } catch (error) {
      window.alert(error.message)
    }
  }

  async function deleteAccount() {
    const password = window.prompt('회원탈퇴를 위해 현재 비밀번호를 입력해 주세요.')
    if (password === null) return
    if (!password) {
      window.alert('비밀번호를 입력해 주세요.')
      return
    }

    const confirmed = window.confirm(
      '회원탈퇴 시 계정과 모든 할 일이 삭제되며 복구할 수 없습니다. 계속할까요?',
    )
    if (!confirmed) return

    try {
      await request(`${AUTH_URL}/me`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      setUser(null)
      setAuthError('회원탈퇴가 완료되었습니다.')
    } catch (error) {
      window.alert(error.message)
    }
  }

  if (user === undefined) {
    return (
      <main className="auth-page">
        <div className="auth-loading" role="status">
          <span className="auth-spinner" />
          <p>로그인 정보를 확인하는 중...</p>
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <AuthScreen
        initialError={authError}
        onAuthenticated={(authenticatedUser) => {
          setUser(authenticatedUser)
          setAuthError('')
        }}
      />
    )
  }

  return (
    <TodoApp
      user={user}
      onLogout={logout}
      onDeleteAccount={deleteAccount}
    />
  )
}

export default App
