<script setup lang="ts">
import type { Session } from '@supabase/supabase-js'
import type { GenerationPreview } from '~/types/generation'
import type { World, LifeEntry } from '~/types/world'

const { configured, client } = useCloud()
const ready = ref(false)
const session = shallowRef<Session | null>(null)
const email = ref('')
const password = ref('')
const registering = ref(false)
const authBusy = ref(false)
const authMessage = ref('')
const world = ref<World | null>(null)
const worldImage = ref('')
const editingAvatar = ref(false)
const caption = ref('')
const occurredOn = ref(localDate())
const photo = ref<File | null>(null)
const preview = ref('')
const pending = ref(false)
const saving = ref(false)
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const notice = ref('')
const result = ref<GenerationPreview | null>(null)
const entries = ref<LifeEntry[]>([])
const urls = ref<Record<string, string>>({})
const selected = ref<LifeEntry | null>(null)
const more = ref(false)
const input = ref<HTMLInputElement | null>(null)
const creating = computed(() => !world.value?.avatar_path || editingAvatar.value)
const busy = computed(() => pending.value || saving.value || loading.value)
let unsubscribe: (() => void) | undefined
let epoch = 0
function localDate() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function clearInput() {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = ''; photo.value = null; caption.value = ''; result.value = null; error.value = ''
  occurredOn.value = localDate()
  if (input.value) input.value.value = ''
}
function clearAccount() {
  epoch++; clearInput(); world.value = null; worldImage.value = ''; entries.value = []; urls.value = {}
  selected.value = null; editingAvatar.value = false; loaded.value = false; notice.value = ''; loading.value = false
}
function changeMode(value: boolean) { clearInput(); editingAvatar.value = value }
async function authenticate() {
  if (!client || authBusy.value) return
  authBusy.value = true; error.value = ''; authMessage.value = ''
  try {
    const response = registering.value
      ? await client.auth.signUp({ email: email.value.trim(), password: password.value })
      : await client.auth.signInWithPassword({ email: email.value.trim(), password: password.value })
    if (response.error) { error.value = registering.value ? '註冊未完成，請確認信箱、密碼或稍後再試。' : '登入未完成，請確認信箱與密碼。'; return }
    password.value = ''
    if (!response.data.session) authMessage.value = '目前沒有取得登入狀態。若是新註冊，請確認 Supabase 已關閉 Confirm email；已有帳號請直接登入。'
  } catch { error.value = '目前無法連線到登入服務，請稍後再試。' }
  finally { authBusy.value = false }
}
async function logout() {
  if (!client || busy.value) return
  const { error: failure } = await client.auth.signOut()
  if (failure) { error.value = '登出未完成，請稍後再試。'; return }
  session.value = null; clearAccount()
}
async function signedPaths(paths: string[]) {
  if (!client) throw new Error('not configured')
  const unique = [...new Set(paths.filter(Boolean))]
  if (!unique.length) return {}
  const { data, error: failure } = await client.storage.from('life-pixel').createSignedUrls(unique, 3600)
  if (failure || data?.some(item => item.error || !item.signedUrl)) throw new Error('image unavailable')
  return Object.fromEntries((data ?? []).map(item => [item.path!, item.signedUrl!]))
}
async function loadWorld() {
  if (!client || !session.value) return
  const loadEpoch = ++epoch
  loading.value = true; error.value = ''; loaded.value = false
  try {
    const uid = session.value.user.id
    const [worldResponse, entryResponse] = await Promise.all([
      client.from('worlds').select('*').eq('user_id', uid).maybeSingle(),
      client.from('entries').select('*').eq('user_id', uid).order('revision', { ascending: false }).limit(20)
    ])
    if (worldResponse.error || entryResponse.error) throw new Error('database unavailable')
    const nextWorld = worldResponse.data as World | null
    const nextEntries = (entryResponse.data ?? []) as LifeEntry[]
    const { data: drafts, error: draftError } = await client.from('generations').select('*')
      .eq('user_id', uid).eq('status', 'ready').eq('base_revision', nextWorld?.revision ?? 0)
      .order('created_at', { ascending: false }).limit(1)
    if (draftError) throw new Error('draft unavailable')
    const draft = drafts?.[0]
    const paths = [nextWorld?.current_image_path ?? '', ...nextEntries.flatMap(item => [item.photo_path, item.image_path]), draft?.photo_path ?? '', draft?.image_path ?? '']
    const nextUrls = await signedPaths(paths)
    if (loadEpoch !== epoch) return
    world.value = nextWorld; entries.value = nextEntries; urls.value = nextUrls
    worldImage.value = nextWorld?.current_image_path ? nextUrls[nextWorld.current_image_path] ?? '' : ''
    more.value = nextEntries.length === 20; selected.value = null
    if (draft && !result.value) {
      result.value = { mode: 'generated', generationId: draft.id, baseRevision: draft.base_revision,
        imageUrl: nextUrls[draft.image_path]!, message: '找到尚未確認的雲端候選圖，可直接確認，不必重新付費生成。', usage: draft.usage }
      caption.value = draft.caption; occurredOn.value = draft.occurred_on
      preview.value = nextUrls[draft.photo_path]!
      editingAvatar.value = draft.kind === 'avatar'
    }
    loaded.value = true
  } catch { if (loadEpoch === epoch) error.value = '雲端讀取未完成，請確認 Supabase 連線、資料表及私人儲存空間已設定，再按重新載入。' }
  finally { if (loadEpoch === epoch) loading.value = false }
}
async function loadMore() {
  if (!client || busy.value || !entries.value.length) return
  const loadEpoch = epoch
  loading.value = true
  try {
    const { data, error: failure } = await client.from('entries').select('*')
      .eq('user_id', session.value!.user.id).lt('revision', entries.value.at(-1)!.revision)
      .order('revision', { ascending: false }).limit(20)
    if (failure) throw failure
    const next = (data ?? []) as LifeEntry[]
    const nextUrls = await signedPaths(next.flatMap(item => [item.photo_path, item.image_path]))
    if (loadEpoch !== epoch) return
    entries.value.push(...next); Object.assign(urls.value, nextUrls); more.value = next.length === 20
  } catch { if (loadEpoch === epoch) error.value = '較早的紀錄讀取失敗，請再試一次。' }
  finally { if (loadEpoch === epoch) loading.value = false }
}
function selectPhoto(event: Event) {
  if (preview.value.startsWith('blob:')) URL.revokeObjectURL(preview.value)
  preview.value = ''; photo.value = null; result.value = null; error.value = ''; notice.value = ''
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    error.value = '請選擇 5 MB 以下的 JPG、PNG 或 WebP。'; return
  }
  photo.value = file; preview.value = URL.createObjectURL(file)
}
async function generate() {
  if (!client || !photo.value || busy.value || !loaded.value) return
  const requestEpoch = epoch
  pending.value = true; error.value = ''; result.value = null; notice.value = ''
  try {
    const { data } = await client.auth.getSession()
    if (!data.session) throw new Error('請先重新登入。')
    const body = new FormData()
    body.append('purpose', creating.value ? 'avatar' : 'life')
    body.append('photo', photo.value); body.append('caption', caption.value)
    body.append('revision', String(world.value?.revision ?? 0)); body.append('occurredOn', occurredOn.value)
    const candidate = await $fetch<GenerationPreview>('/api/generate', { method: 'POST', body,
      headers: { Authorization: `Bearer ${data.session.access_token}` }, retry: 0 })
    if (requestEpoch === epoch) result.value = candidate
  } catch (cause) {
    if (requestEpoch !== epoch) return
    const failure = cause as { data?: { data?: { message?: string }; message?: string } }
    error.value = failure?.data?.data?.message || failure?.data?.message || '這次沒有完成，請先重新載入雲端候選圖再決定是否重試。'
  } finally { pending.value = false }
}
async function confirmResult() {
  if (!client || !result.value || busy.value) return
  saving.value = true; error.value = ''
  try {
    const { error: failure } = await client.rpc('confirm_generation', { p_id: result.value.generationId })
    if (failure) {
      error.value = failure.message.includes('WORLD_CHANGED') ? '其他分頁已更新世界。請重新載入，這張舊版本候選圖不會覆蓋新世界。' : '確認未完成，候選圖仍保留在雲端，可以再次按確認，不會重新生圖扣費。'
      return
    }
    editingAvatar.value = false; clearInput()
    notice.value = '已存檔！世界與這筆生活紀錄已同步到你的帳號。'
    await loadWorld()
  } catch { error.value = '連線中斷，候選圖仍保留在雲端。請重新載入確認狀態，再按確認，不必重新生圖。' }
  finally { saving.value = false }
}
onMounted(async () => {
  if (!client) { ready.value = true; return }
  try {
    const { data } = await client.auth.getSession()
    session.value = data.session
    if (data.session) await loadWorld()
  } catch { error.value = '登入狀態讀取失敗，請重新整理再試。' }
  const { data: listener } = client.auth.onAuthStateChange((event, nextSession) => {
    const changed = session.value?.user.id !== nextSession?.user.id
    session.value = nextSession
    if (changed) {
      clearAccount()
      if (nextSession) setTimeout(() => { void loadWorld() }, 0)
    }
  })
  unsubscribe = () => listener.subscription.unsubscribe()
  ready.value = true
})
onBeforeUnmount(() => { unsubscribe?.(); epoch++; if (preview.value.startsWith('blob:')) URL.revokeObjectURL(preview.value) })
</script>
<template>
  <main>
    <header><NuxtLink to="/" class="brand">生活亂入</NuxtLink><div class="account" v-if="session"><span>{{ session.user.email }}</span><button class="secondary compact" :disabled="busy" @click="logout">登出</button></div><span v-else>我的像素生活</span></header>
    <section class="intro"><p class="eyebrow">讓生活，慢慢長成你的世界</p><h1>{{ session && creating ? '先創建一個' : '你都不知道' }}<br>{{ session && creating ? '像素的自己。' : '你多荒唐。' }}</h1><p>留下今天的小事，讓像素世界記得你的生活。</p></section>
    <section v-if="!configured" class="setup-card">
      <h2>準備連接你的雲端世界</h2><p>登入與跨裝置存檔已加入，還需要設定 Supabase 專案。</p>
      <ol><li>在 Supabase 建立專案。</li><li>在 SQL Editor 執行專案內的資料表設定檔。</li><li>把專案 URL 與公開金鑰填入 .env，重新啟動。</li></ol>
      <p class="hint">完整步驟請看專案的 SUPABASE_SETUP.md。原本存在瀏覽器的角色仍保留，不會自動上傳。</p>
    </section>
    <p v-else-if="!ready" role="status">正在讀取你的世界…</p>
    <form v-else-if="!session" class="auth-card" @submit.prevent="authenticate">
      <h2>{{ registering ? '建立帳號' : '登入我的世界' }}</h2><p>{{ registering ? '使用信箱與密碼註冊，不需要點驗證信。請填寫自己的常用信箱。' : '照片與紀錄僅限自己的帳號查看。' }}</p>
      <label for="email">電子信箱</label><input id="email" v-model="email" type="email" autocomplete="email" required :disabled="authBusy">
      <label for="password">密碼</label><input id="password" v-model="password" type="password" :autocomplete="registering ? 'new-password' : 'current-password'" minlength="8" required :disabled="authBusy">
      <button :disabled="authBusy">{{ authBusy ? '請稍等…' : registering ? '註冊' : '登入' }}</button>
      <button class="secondary" type="button" :disabled="authBusy" @click="registering = !registering; error = ''; authMessage = ''">{{ registering ? '已有帳號，前往登入' : '第一次來，建立帳號' }}</button>
      <p v-if="authMessage" role="status">{{ authMessage }}</p><p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>
    <template v-else>
      <div class="sync-bar"><span>{{ world ? `世界版本 ${world.revision}` : '我的新世界' }} · 私人雲端存檔</span><button type="button" class="secondary compact" :disabled="busy" @click="clearInput(); loadWorld()">{{ loading ? '同步中…' : '重新載入雲端' }}</button></div>
      <p v-if="notice" class="success" role="status">{{ notice }}</p>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <div class="workspace">
        <form @submit.prevent="generate">
          <h2>{{ creating ? '建立我的像素分身' : '餵今天的生活' }}</h2>
          <label for="photo">{{ creating ? '自己的照片' : '生活照片' }}</label>
          <input id="photo" ref="input" type="file" accept="image/jpeg,image/png,image/webp" :disabled="busy || !loaded" @change="selectPhoto">
          <p class="hint">{{ creating ? '建議單人、臉部清楚；全身照更容易保留穿搭。' : '食物、活動、狗狗或任何想留下的小事。' }} 最多 5 MB。</p>
          <img v-if="preview" :src="preview" class="upload-preview" alt="這次紀錄的原始照片">
          <label for="date">紀錄日期</label><input id="date" v-model="occurredOn" type="date" required :disabled="busy || !!result">
          <label for="caption">{{ creating ? '想保留什麼特徵？' : '這張照片有什麼故事？' }}</label>
          <textarea id="caption" v-model="caption" maxlength="300" rows="3" :placeholder="creating ? '例如：保留眼鏡、短髮和白色上衣。' : '最近很愛喝這杯，已經快變成我的本體。'" :disabled="busy || !!result" />
          <p class="hint">照片與文字會傳給 AI，並存到你的私人雲端。每次生成皆付費；生活圖每日最多 3 次，角色 5 次（UTC 午夜重置，失敗或逾時也計入）。</p>
          <button :disabled="!photo || busy || !loaded || !!result">{{ pending ? '正在畫並存到雲端…' : creating ? '生成我的像素分身' : '延續世界，生成今天的圖' }}</button>
          <button v-if="result" type="button" class="secondary" :disabled="busy" @click="clearInput()">換張照片，重新創作</button>
          <button v-if="editingAvatar" type="button" class="secondary" :disabled="busy" @click="changeMode(false)">返回生活</button>
        </form>
        <section class="world" aria-live="polite">
          <h2>{{ result ? '這次的候選圖' : '我的最新世界' }}</h2>
          <img v-if="result || worldImage" :src="result?.imageUrl || worldImage" :alt="result ? '尚未確認的像素候選圖' : '最新確認的像素世界'">
          <p v-else class="empty-avatar">你的世界會出現在這裡。<br>先建立自己的角色。</p>
          <p class="notice">{{ result?.message || '下一次生成會參考你的角色、最新世界與最近七筆紀錄。確認候選圖後才更新世界；舊照片與世界版本會留在下方。' }}</p>
          <button v-if="result" :disabled="busy || !loaded" @click="confirmResult">{{ saving ? '正在確認存檔…' : creating ? '就是我！建立我的世界' : '確認，存進我的生活紀錄' }}</button>
          <p v-if="result?.usage?.total_tokens" class="hint">這次 API 回報 {{ result.usage.total_tokens.toLocaleString() }} tokens，非帳務金額。</p>
          <button v-if="world?.avatar_path && !creating && !result" type="button" class="secondary" :disabled="busy" @click="changeMode(true)">重新建立角色</button>
        </section>
      </div>
      <section class="history">
        <h2>我的生活紀錄</h2><p class="hint">每張照片，都有一個對應的像素回憶。點開看當時的故事。</p>
        <p v-if="loaded && !entries.length">還沒有確認的紀錄，從今天開始。</p>
        <div class="history-grid"><button v-for="entry in entries" :key="entry.id" class="entry-card" @click="selected = entry"><img :src="urls[entry.image_path]" loading="lazy" alt="這筆紀錄的像素世界"><span>{{ entry.occurred_on }} · {{ entry.kind === 'avatar' ? '角色' : '生活' }}</span><strong>{{ entry.caption || (entry.kind === 'avatar' ? '像素的自己' : '今天的小事') }}</strong><span>世界版本 {{ entry.revision }}</span></button></div>
        <button v-if="more" class="secondary" :disabled="busy" @click="loadMore">更早的紀錄</button>
        <section v-if="selected" class="entry-detail" aria-label="生活紀錄詳情"><div class="sync-bar"><h3>{{ selected.occurred_on }} · 世界版本 {{ selected.revision }}</h3><button class="secondary compact" @click="selected = null">收起</button></div><p class="story">{{ selected.caption || '沒有文字說明，照片也記得這一天。' }}</p><div class="comparison"><figure><img :src="urls[selected.photo_path]" alt="當時上傳的原始照片"><figcaption>那天的照片</figcaption></figure><figure><img :src="urls[selected.image_path]" class="pixel-image" alt="當時確認的像素世界"><figcaption>那天的像素世界</figcaption></figure></div></section>
      </section>
    </template>
  </main>
</template>
