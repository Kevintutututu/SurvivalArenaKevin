// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBmnTyCdKj5KGvFAcqRXju_eUWCGSaRHDM",
    authDomain: "survival-arena-kevin.firebaseapp.com",
    projectId: "survival-arena-kevin",
    storageBucket: "survival-arena-kevin.firebasestorage.app",
    messagingSenderId: "386302462782",
    appId: "1:386302462782:web:029d788e9748179fdf3a6f"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };
