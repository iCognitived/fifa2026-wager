import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBi_vQl8pYylIJp-h8eArZaf8GWh-ISPT0",
  authDomain: "fifa-26-7cec2.firebaseapp.com",
  projectId: "fifa-26-7cec2",
  storageBucket: "fifa-26-7cec2.firebasestorage.app",
  messagingSenderId: "554093521481",
  appId: "1:554093521481:web:897d527b061e40a2bd6d98",
  measurementId: "G-X298H2FH9J"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
