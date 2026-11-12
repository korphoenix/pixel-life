const databaseName = 'life-pixel'
async function database(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('settings')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function readAvatar(): Promise<string | null> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('settings').objectStore('settings').get('avatar')
      request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null)
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}
export async function saveAvatar(image: string): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('settings', 'readwrite')
      transaction.objectStore('settings').put(image, 'avatar')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { db.close() }
}
