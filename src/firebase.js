import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyCJTsM3JOuh8tkjGrZPXzR1VVIx8lwANEo",
  authDomain: "robocontrol-snmyl.firebaseapp.com",
  projectId: "robocontrol-snmyl",
  storageBucket: "robocontrol-snmyl.firebasestorage.app",
  messagingSenderId: "753891876454",
  appId: "1:753891876454:web:52f5911a74c6a4057a17a7"
}

export const firebaseApp = initializeApp(firebaseConfig)
export const auth = getAuth(firebaseApp)
export const db = getFirestore(firebaseApp)
export const ensureFirebaseAuth = () => signInAnonymously(auth)
