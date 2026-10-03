import "./style.css";

import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { initializeApp } from "firebase/app";

import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  signOut
} from "firebase/auth";

import {
  getFirestore,
  collection,
  addDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  query,
  where,
  limit,
  onSnapshot,
  serverTimestamp,
  runTransaction
} from "firebase/firestore";

import { Geolocation } from "@capacitor/geolocation";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "firebase/storage";


/* ======================================================
   FIREBASE
   ====================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyAZVXuhTTiGKfDflIZUm_8IgzhRjjWsfIc",
  authDomain: "wasselni-monufia-13f28.firebaseapp.com",
  projectId: "wasselni-monufia-13f28",
  storageBucket: "wasselni-monufia-13f28.firebasestorage.app",
  messagingSenderId: "1007737426615",
  appId: "1:1007737426615:web:76492206c1cd5f3fcef332",
  measurementId: "G-7K0MVY6F73"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getFirestore(app);

const storage = getStorage(app);

setPersistence(
  auth,
  browserLocalPersistence
).catch(console.error);


/* ======================================================
   GLOBAL STATE
   ====================================================== */

let user = null;

let profile = null;

let map = null;

let pickupMarker = null;

let destMarker = null;

let routeLayer = null;

let accuracyCircle = null;

let watchRides = null;

let watchCustomer = null;

let watchCaptainAccepted = null;

let pickup = null;

let destination = null;


/* ======================================================
   HELPERS
   ====================================================== */

const $ = (selector) =>
  document.querySelector(selector);


const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[m]
  );


function phone(value) {

  value = String(value || "")
    .trim()
    .replace(/[\s()-]/g, "");

  if (value.startsWith("00")) {
    value = "+" + value.slice(2);
  }

  if (value.startsWith("01")) {
    value = "+20" + value;
  }

  if (
    value.startsWith("20") &&
    !value.startsWith("+")
  ) {
    value = "+" + value;
  }

  return value;
}


function loginEmail(phoneNumber) {

  return (
    phone(phoneNumber).replace(/\D/g, "") +
    "@phone.wasselni.app"
  );

}


function accountNo() {

  return String(
    Math.floor(
      10000000 +
      Math.random() * 90000000
    )
  );

}


function msg(text, type = "info") {

  const element = $("#message");

  if (!element) return;

  element.textContent = text;

  element.className =
    `message-box ${type}`;

  element.style.display = "block";

  clearTimeout(window.__msg);

  window.__msg = setTimeout(
    () => {
      element.style.display = "none";
    },
    4500
  );

}


function screen(id) {

  document
    .querySelectorAll(".screen")
    .forEach(
      (element) =>
        element.classList.remove("active")
    );

  $("#" + id)?.classList.add("active");

  if ($("#nav")) {

    $("#nav").style.display =
      ["login", "register"].includes(id)
        ? "none"
        : "flex";

  }

}


function statusText(status) {

  return (
    {
      open: "بانتظار كابتن",
      accepted: "تم قبول الرحلة",
      captain_to_customer: "الكابتن في الطريق",
      arrived: "الكابتن وصل",
      started: "الرحلة بدأت",
      completed: "انتهت الرحلة",
      cancelled: "ملغاة"
    }[status] ||
    status ||
    "غير معروف"
  );

}


function dayName(date) {

  if (!date) return "";

  return new Intl.DateTimeFormat(
    "ar-EG",
    {
      weekday: "long"
    }
  ).format(
    new Date(`${date}T12:00:00`)
  );

}


function formatDate(value) {

  if (!value) return "";

  return new Intl.DateTimeFormat(
    "ar-EG",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }
  ).format(
    new Date(`${value}T12:00:00`)
  );

}
/* ======================================================
   PROFILE PHOTO HELPERS
   ====================================================== */

function avatarHTML(name, photoURL = "", size = "normal") {

  const safeName = esc(name || "مستخدم");

  if (photoURL) {

    return `
      <div class="profile-avatar ${size}">
        <img
          src="${esc(photoURL)}"
          alt="${safeName}"
          onerror="this.style.display='none';this.parentElement.classList.add('avatar-fallback')"
        >
      </div>
    `;

  }

  const firstLetter =
    String(name || "م")
      .trim()
      .charAt(0) || "م";

  return `
    <div class="profile-avatar ${size} avatar-fallback">
      ${esc(firstLetter)}
    </div>
  `;

}


/* ======================================================
   IMAGE COMPRESSION
   ====================================================== */

async function compressProfileImage(file) {

  if (!file) return null;

  if (!file.type.startsWith("image/")) {

    throw new Error(
      "الملف المختار لازم يكون صورة."
    );

  }

  const maxSize = 512;

  const bitmap = await createImageBitmap(file);

  let width = bitmap.width;

  let height = bitmap.height;

  if (width > height) {

    if (width > maxSize) {

      height =
        Math.round(
          height * (maxSize / width)
        );

      width = maxSize;

    }

  } else {

    if (height > maxSize) {

      width =
        Math.round(
          width * (maxSize / height)
        );

      height = maxSize;

    }

  }

  const canvas =
    document.createElement("canvas");

  canvas.width = width;

  canvas.height = height;

  const context =
    canvas.getContext("2d");

  context.drawImage(
    bitmap,
    0,
    0,
    width,
    height
  );

  const blob =
    await new Promise(
      (resolve) =>
        canvas.toBlob(
          resolve,
          "image/jpeg",
          0.78
        )
    );

  if (!blob) {

    throw new Error(
      "تعذر تجهيز الصورة."
    );

  }

  return blob;

}


/* ======================================================
   UPLOAD PROFILE PHOTO
   ====================================================== */

async function uploadProfilePhoto(
  uid,
  file
) {

  if (!uid || !file) return "";

  const compressed =
    await compressProfileImage(file);

  const fileRef =
    ref(
      storage,
      `profiles/${uid}/profile.jpg`
    );

  await uploadBytes(
    fileRef,
    compressed,
    {
      contentType: "image/jpeg"
    }
  );

  return await getDownloadURL(
    fileRef
  );

}


/* ======================================================
   GET PROFILE
   ====================================================== */

async function loadProfile() {

  if (!user) return null;

  try {

    const snapshot =
      await getDoc(
        doc(db, "users", user.uid)
      );

    if (snapshot.exists()) {

      profile = {
        uid: user.uid,
        ...snapshot.data()
      };

      return profile;

    }

  } catch (error) {

    console.error(
      "loadProfile error:",
      error
    );

  }

  return null;

}


/* ======================================================
   PROFILE CARD
   ====================================================== */

function profileHeader(
  name,
  photoURL,
  role = "customer"
) {

  const roleText =
    role === "captain"
      ? "🚗 كابتن"
      : "👤 عميل";

  return `
    <div class="profile-header">

      ${avatarHTML(
        name,
        photoURL,
        "large"
      )}

      <div class="profile-header-info">

        <strong>
          ${esc(name || "بدون اسم")}
        </strong>

        <span>
          ${roleText}
        </span>

      </div>

    </div>
  `;

}


/* ======================================================
   CUSTOMER INFO
   ====================================================== */

function customerInfoHTML(ride) {

  return `
    <div class="person-card customer-person">

      ${avatarHTML(
        ride.customerName,
        ride.customerPhoto,
        "small"
      )}

      <div class="person-info">

        <strong>
          ${esc(
            ride.customerName ||
            "عميل"
          )}
        </strong>

        <span>
          👤 العميل
        </span>

      </div>

    </div>
  `;

}


/* ======================================================
   CAPTAIN INFO
   ====================================================== */

function captainInfoHTML(ride) {

  return `
    <div class="person-card captain-person">

      ${avatarHTML(
        ride.captainName,
        ride.captainPhoto,
        "small"
      )}

      <div class="person-info">

        <strong>
          ${esc(
            ride.captainName ||
            "الكابتن"
          )}
        </strong>

        <span>
          🚗 ${esc(
            ride.carType || ""
          )}
          ${esc(
            ride.carModel || ""
          )}
        </span>

        ${
          ride.captainPhone
            ? `
              <span>
                📞 ${esc(
                  ride.captainPhone
                )}
              </span>
            `
            : ""
        }

      </div>

    </div>
  `;

}


/* ======================================================
   PREPARE PROFILE PHOTO INPUT
   ====================================================== */

function getSelectedProfilePhoto() {

  const input =
    $("#profilePhotoInput");

  if (
    !input ||
    !input.files ||
    !input.files.length
  ) {

    return null;

  }

  return input.files[0];

}
/* ======================================================
   PART 3 — APP UI
   ====================================================== */

$("#app").innerHTML = `
<div class="app">

<header class="header">
  <div class="logo">🚕 وصلني <span>المنوفية</span></div>
  <button id="profileTop" class="icon-button">👤</button>
</header>

<div id="message" class="message-box" style="display:none"></div>

<!-- LOGIN -->
<section id="login" class="screen active">
  <div class="auth-card">

    <div class="auth-logo">🚕</div>

    <h1>وصلني المنوفية</h1>

    <p class="muted">
      سجل دخولك وابدأ رحلتك بسهولة
    </p>

    <label>📱 رقم الموبايل</label>
    <input
      id="loginPhone"
      type="tel"
      inputmode="tel"
      placeholder="010xxxxxxxx"
    >

    <label>🔐 كلمة المرور</label>
    <input
      id="loginPass"
      type="password"
      placeholder="كلمة المرور"
    >

    <button id="loginBtn" class="btn primary">
      تسجيل الدخول
    </button>

    <button id="registerOpen" class="btn outline">
      إنشاء حساب جديد
    </button>

    <div id="loginMsg" class="status"></div>

  </div>
</section>


<!-- REGISTER -->
<section id="register" class="screen">

  <div class="auth-card">

    <button id="backLogin" class="back-btn">
      ← رجوع
    </button>

    <h2>إنشاء حساب جديد</h2>

    <p class="muted">
      اكتب بياناتك الأساسية
    </p>

    <label>نوع الحساب</label>

    <select id="role">
      <option value="customer">👤 عميل</option>
      <option value="captain">🚗 كابتن</option>
    </select>


    <!-- PHOTO -->
    <div class="photo-upload">

      <div id="registerPhotoPreview" class="register-photo-preview">
        👤
      </div>

      <label class="photo-button">
        📷 إضافة صورة شخصية
        <input
          id="profilePhotoInput"
          type="file"
          accept="image/*"
          hidden
        >
      </label>

      <small class="muted">
        الصورة اختيارية
      </small>

    </div>


    <label>👤 الاسم بالكامل</label>

    <input
      id="name"
      placeholder="اكتب اسمك بالكامل"
    >


    <label>📱 رقم الموبايل</label>

    <input
      id="regPhone"
      type="tel"
      inputmode="tel"
      placeholder="010xxxxxxxx"
    >


    <label>🔐 كلمة المرور</label>

    <input
      id="regPass"
      type="password"
      placeholder="6 أحرف أو أرقام على الأقل"
    >


    <label>🔐 تأكيد كلمة المرور</label>

    <input
      id="regPass2"
      type="password"
      placeholder="تأكيد كلمة المرور"
    >


    <!-- CAPTAIN DATA -->
    <div id="captainFields" style="display:none">

      <div class="section-title">
        🚗 بيانات الكابتن
      </div>

      <label>🎂 السن</label>

      <input
        id="age"
        type="number"
        min="18"
        placeholder="السن"
      >


      <label>🚘 نوع العربية</label>

      <input
        id="carType"
        placeholder="سيدان / ميكروباص / نص نقل"
      >


      <label>🚗 موديل العربية</label>

      <input
        id="carModel"
        placeholder="مثال: لانسر 2018"
      >


      <label>🔢 رقم اللوحة</label>

      <input
        id="plate"
        placeholder="رقم اللوحة"
      >

    </div>


    <button id="finishReg" class="btn green">
      إنشاء الحساب
    </button>

    <div id="regMsg" class="status"></div>

  </div>

</section>


<!-- HOME CUSTOMER -->
<section id="home" class="screen">

  <div class="hero">

    <h2>أهلاً بيك 👋</h2>

    <p>
      اطلب رحلتك وحدد كل التفاصيل.
    </p>

  </div>


  <div class="card">

    <label>📍 مكان الانطلاق</label>

    <button id="myLocation" class="btn outline">
      🎯 تحديد موقعي بدقة
    </button>

    <div id="pickupText" class="status">
      لم يتم تحديد موقعك
    </div>

  </div>


  <div class="card">

    <label>🏁 مكان الوصول</label>

    <button id="chooseDest" class="btn outline">
      🗺️ تحديد مكان النزول على الخريطة
    </button>

    <div id="destText" class="status">
      لم يتم تحديد مكان الوصول
    </div>

  </div>


  <div class="card">

    <label>📅 يوم الرحلة</label>

    <input
      id="rideDate"
      type="date"
    >

    <div id="dayPreview" class="status"></div>


    <label>🕐 وقت الرحلة</label>

    <input
      id="rideTime"
      type="time"
    >


    <label>👥 عدد الركاب</label>

    <select id="passengers">
      ${Array.from(
        {length:8},
        (_,i)=>`<option value="${i+1}">${i+1}</option>`
      ).join("")}
    </select>


    <label>💰 السعر المقترح</label>

    <input
      id="price"
      type="number"
      min="1"
      placeholder="مثال 150"
    >


    <label>📝 الرسالة / الملاحظات</label>

    <textarea
      id="notes"
      rows="3"
      placeholder="شنطة كبيرة، طفل، شارع ضيق، أي ملاحظة للكابتن..."
    ></textarea>


    <button id="request" class="btn primary">
      🚕 نشر الرحلة للكباتن
    </button>

  </div>

</section>


<!-- MAP -->
<section id="mapScreen" class="screen">

  <div class="card">

    <div class="map-head">

      <div>
        <h2>🗺️ تحديد المكان</h2>

        <small>
          حرّك الخريطة حتى الدبوس فوق المكان المطلوب.
        </small>
      </div>

      <button
        id="closeMap"
        class="btn danger small-btn"
      >
        إلغاء
      </button>

    </div>


    <input
      id="search"
      placeholder="🔎 ابحث عن شارع، قرية، منزل أو مكان"
    >


    <div id="results" class="search-results"></div>

  </div>


  <div class="map-wrapper">

    <div id="map"></div>

    <div class="map-center-pin">
      📍
    </div>

    <button
      id="mapLocation"
      class="map-control"
    >
      🎯
    </button>

  </div>


  <div class="card">

    <div id="address" class="status">
      حدد المكان.
    </div>

    <div id="coords" class="coords"></div>

    <button
      id="confirmDest"
      class="btn primary"
    >
      ✅ تأكيد المكان
    </button>

  </div>

</section>


<!-- CUSTOMER RIDES -->
<section id="rides" class="screen">

  <div class="hero">

    <h2>📋 رحلاتي</h2>

    <p>
      تابع الرحلة من النشر حتى الانتهاء.
    </p>

  </div>

  <div id="ridesList"></div>

</section>


<!-- CAPTAIN -->
<section id="captain" class="screen">

  <div class="hero">

    <h2>🚗 منصة الكابتن</h2>

    <p>
      فعّل حالتك وشوف الرحلات الجديدة.
    </p>

  </div>


  <div class="card captain-toggle">

    <button
      id="captainAvailable"
      class="btn green"
    >
      🟢 أنا متاح
    </button>


    <button
      id="captainUnavailable"
      class="btn outline"
    >
      ⚫ غير متاح
    </button>


    <div id="captainState" class="status"></div>

  </div>


  <h3>
    📢 الرحلات الجديدة
  </h3>

  <div id="captainList"></div>


  <h3>
    🚕 رحلات قبلتها
  </h3>

  <div id="captainAcceptedList"></div>

</section>


<!-- PROFILE -->
<section id="profile" class="screen">

  <div class="card profile-card">

    <div id="profileInfo"></div>

    <button
      id="logout"
      class="btn danger"
    >
      تسجيل الخروج
    </button>

  </div>

</section>


<!-- NAVIGATION -->
<nav id="nav" class="nav">

  <button id="navHome">
    🏠
    <br>
    الرئيسية
  </button>

  <button id="navRides">
    📋
    <br>
    رحلاتي
  </button>

  <button id="navCaptain">
    🚗
    <br>
    الكابتن
  </button>

  <button id="navProfile">
    👤
    <br>
    حسابي
  </button>

</nav>

</div>
`;


/* ======================================================
   REGISTER PHOTO PREVIEW
   ====================================================== */

$("#profilePhotoInput")?.addEventListener("change", e => {

  const file = e.target.files?.[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {

    msg("اختار صورة فقط.", "error");

    e.target.value = "";

    return;
  }

  const reader = new FileReader();

  reader.onload = () => {

    const preview = $("#registerPhotoPreview");

    if (!preview) return;

    preview.innerHTML = `
      <img
        src="${reader.result}"
        alt="الصورة الشخصية"
      >
    `;

  };

  reader.readAsDataURL(file);

});


/* ======================================================
   ROLE CHANGE
   ====================================================== */

$("#role").onchange = () => {

  const captain =
    $("#role").value === "captain";

  $("#captainFields").style.display =
    captain ? "block" : "none";

};


/* ======================================================
   LOGIN / REGISTER NAVIGATION
   ====================================================== */

$("#registerOpen").onclick = () => {

  screen("register");

};


$("#backLogin").onclick = () => {

  screen("login");

};
/* ======================================================
   PART 4 — REGISTER / LOGIN / PROFILE DATA
   ====================================================== */


/* ======================================================
   FINISH REGISTER
   ====================================================== */

$("#finishReg").onclick = async () => {

  const btn = $("#finishReg");

  const name = $("#name").value.trim();

  const p = phone($("#regPhone").value);

  const pass = $("#regPass").value;

  const pass2 = $("#regPass2").value;

  const role = $("#role").value;

  const photoFile =
    $("#profilePhotoInput")?.files?.[0] || null;

  $("#regMsg").textContent = "";


  /* ---------- BASIC VALIDATION ---------- */

  if (!name) {

    $("#regMsg").textContent =
      "اكتب الاسم بالكامل.";

    return;
  }


  if (!/^\+20\d{10}$/.test(p)) {

    $("#regMsg").textContent =
      "اكتب رقم موبايل مصري صحيح مثل 010xxxxxxxx.";

    return;
  }


  if (pass.length < 6) {

    $("#regMsg").textContent =
      "كلمة المرور لازم تكون 6 أحرف أو أرقام على الأقل.";

    return;
  }


  if (pass !== pass2) {

    $("#regMsg").textContent =
      "كلمتا المرور غير متطابقتين.";

    return;
  }


  /* ---------- CAPTAIN VALIDATION ---------- */

  if (
    role === "captain" &&
    (
      !$("#age").value ||
      Number($("#age").value) < 18 ||
      !$("#carType").value.trim() ||
      !$("#carModel").value.trim() ||
      !$("#plate").value.trim()
    )
  ) {

    $("#regMsg").textContent =
      "أكمل بيانات الكابتن: السن ونوع العربية والموديل ورقم اللوحة.";

    return;
  }


  try {

    btn.disabled = true;

    btn.textContent =
      "جاري إنشاء الحساب...";


    /* ---------- CREATE FIREBASE ACCOUNT ---------- */

    const cred =
      await createUserWithEmailAndPassword(
        auth,
        loginEmail(p),
        pass
      );


    const u = cred.user;


    /* ---------- BASIC PROFILE ---------- */

    const data = {

      uid: u.uid,

      name: name,

      phone: p,

      role: role,

      accountNumber: accountNo(),

      photoURL: "",

      createdAt: serverTimestamp(),

      rating: 0,

      ratingCount: 0

    };


    /* ---------- CAPTAIN DATA ---------- */

    if (role === "captain") {

      data.age =
        Number($("#age").value);

      data.carType =
        $("#carType").value.trim();

      data.carModel =
        $("#carModel").value.trim();

      data.plateNumber =
        $("#plate").value.trim();

      data.captainStatus =
        "available";
    }


    /* ---------- SAVE PROFILE ---------- */

    await setDoc(
      doc(db, "users", u.uid),
      data,
      { merge: true }
    );


    /* ---------- UPLOAD PHOTO ---------- */

    if (photoFile) {

      try {

        btn.textContent =
          "جاري رفع الصورة...";


        const photoURL =
          await uploadProfilePhoto(
            u.uid,
            photoFile
          );


        data.photoURL = photoURL;


        await updateDoc(
          doc(db, "users", u.uid),
          {
            photoURL: photoURL
          }
        );

      } catch (photoError) {

        console.error(
          "PHOTO UPLOAD ERROR:",
          photoError
        );

        /*
         * الحساب نفسه يظل موجودًا
         * حتى لو حصلت مشكلة في الصورة.
         */

        msg(
          "تم إنشاء الحساب، لكن تعذر رفع الصورة.",
          "error"
        );
      }
    }


    /* ---------- LOCAL PROFILE ---------- */

    user = u;

    profile = data;


    $("#regMsg").textContent =
      "تم إنشاء الحساب بنجاح ✅";


    msg(
      "تم إنشاء الحساب وتسجيل الدخول ✅",
      "success"
    );


    /* ---------- OPEN CORRECT SCREEN ---------- */

    if (role === "captain") {

      screen("captain");

      loadCaptain();

    } else {

      screen("home");

      loadCustomerRides();

    }


  } catch (e) {

    console.error(
      "REGISTER ERROR:",
      e
    );


    if (
      e.code ===
      "auth/email-already-in-use"
    ) {

      $("#regMsg").textContent =
        "الرقم ده مسجل بالفعل. استخدم تسجيل الدخول.";

    } else if (
      e.code ===
      "auth/invalid-email"
    ) {

      $("#regMsg").textContent =
        "رقم الموبايل غير صحيح.";

    } else if (
      e.code ===
      "auth/weak-password"
    ) {

      $("#regMsg").textContent =
        "كلمة المرور ضعيفة. استخدم 6 أحرف أو أرقام على الأقل.";

    } else {

      $("#regMsg").textContent =
        e.message ||
        "تعذر إنشاء الحساب.";

    }

  } finally {

    btn.disabled = false;

    btn.textContent =
      "إنشاء الحساب";

  }

};


/* ======================================================
   LOGIN
   ====================================================== */

$("#loginBtn").onclick = async () => {

  const p =
    phone($("#loginPhone").value);

  const pass =
    $("#loginPass").value;


  $("#loginMsg").textContent = "";


  if (
    !/^\+20\d{10}$/.test(p) ||
    !pass
  ) {

    $("#loginMsg").textContent =
      "اكتب رقم موبايل مصري صحيح وكلمة المرور.";

    return;
  }


  try {

    $("#loginBtn").disabled = true;

    $("#loginBtn").textContent =
      "جاري تسجيل الدخول...";


    await signInWithEmailAndPassword(
      auth,
      loginEmail(p),
      pass
    );


  } catch (e) {

    console.error(
      "LOGIN ERROR:",
      e
    );


    if (
      e.code ===
      "auth/too-many-requests"
    ) {

      $("#loginMsg").textContent =
        "محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.";

    } else {

      $("#loginMsg").textContent =
        "رقم الموبايل أو كلمة المرور غير صحيحة، أو الحساب غير موجود.";

    }

  } finally {

    $("#loginBtn").disabled = false;

    $("#loginBtn").textContent =
      "تسجيل الدخول";

  }

};


/* ======================================================
   LOAD PROFILE
   ====================================================== */

async function loadProfile() {

  if (!user) return;


  try {

    const snap =
      await getDoc(
        doc(db, "users", user.uid)
      );


    if (!snap.exists()) {

      profile = null;

      return;
    }


    profile = snap.data();


    const profileInfo =
      $("#profileInfo");


    if (!profileInfo) return;


    profileInfo.innerHTML = `

      <div class="profile-header">

        ${avatarHTML(
          profile.name,
          profile.photoURL,
          110
        )}

        <div class="profile-name">

          <h2>
            ${esc(profile.name || "بدون اسم")}
          </h2>

          <div class="profile-role">

            ${
              profile.role === "captain"
                ? "🚗 كابتن"
                : "👤 عميل"
            }

          </div>

        </div>

      </div>


      <div class="profile-data">

        <div class="profile-row">

          <span>👤 الاسم</span>

          <strong>
            ${esc(profile.name || "")}
          </strong>

        </div>


        <div class="profile-row">

          <span>📱 الموبايل</span>

          <strong>
            ${esc(profile.phone || "")}
          </strong>

        </div>


        <div class="profile-row">

          <span>🔢 رقم الحساب</span>

          <strong>
            ${esc(profile.accountNumber || "")}
          </strong>

        </div>


        <div class="profile-row">

          <span>👥 نوع الحساب</span>

          <strong>
            ${
              profile.role === "captain"
                ? "🚗 كابتن"
                : "👤 عميل"
            }
          </strong>

        </div>


        ${
          profile.role === "captain"
            ? `

              <div class="profile-row">

                <span>🎂 السن</span>

                <strong>
                  ${esc(profile.age || "")}
                </strong>

              </div>


              <div class="profile-row">

                <span>🚘 نوع العربية</span>

                <strong>
                  ${esc(profile.carType || "")}
                </strong>

              </div>


              <div class="profile-row">

                <span>🚗 موديل العربية</span>

                <strong>
                  ${esc(profile.carModel || "")}
                </strong>

              </div>


              <div class="profile-row">

                <span>🔢 رقم اللوحة</span>

                <strong>
                  ${esc(profile.plateNumber || "")}
                </strong>

              </div>


              <div class="profile-row">

                <span>⭐ التقييم</span>

                <strong>
                  ${Number(
                    profile.rating || 0
                  ).toFixed(1)}

                  (
                    ${Number(
                      profile.ratingCount || 0
                    )}
                  )
                </strong>

              </div>

            `
            : ""
        }

      </div>

    `;


  } catch (e) {

    console.error(
      "LOAD PROFILE ERROR:",
      e
    );

    msg(
      "تعذر تحميل بيانات الحساب.",
      "error"
    );

  }

};


/* ======================================================
   NAVIGATION TO PROFILE
   ====================================================== */

$("#navProfile").onclick = async () => {

  await loadProfile();

  screen("profile");

};


$("#profileTop").onclick = async () => {

  await loadProfile();

  screen("profile");

};


/* ======================================================
   LOGOUT
   ====================================================== */

$("#logout").onclick = async () => {

  try {

    if (watchRides) {

      watchRides();

      watchRides = null;

    }


    if (watchCustomer) {

      watchCustomer();

      watchCustomer = null;

    }


    if (watchCaptainAccepted) {

      watchCaptainAccepted();

      watchCaptainAccepted = null;

    }


    await signOut(auth);


    user = null;

    profile = null;

    pickup = null;

    destination = null;


    screen("login");


    msg(
      "تم تسجيل الخروج.",
      "success"
    );


  } catch (e) {

    console.error(e);

    msg(
      "تعذر تسجيل الخروج.",
      "error"
    );

  }

};
/* ======================================================
   PART 5 — LOCATION + MAP + SEARCH
   ====================================================== */


/* ======================================================
   GET EXACT DEVICE LOCATION
   ====================================================== */

async function exactLocation() {

  const permissions =
    await Geolocation.checkPermissions();

  if (permissions.location !== "granted") {

    const requested =
      await Geolocation.requestPermissions();

    if (requested.location !== "granted") {

      throw new Error("LOCATION_DENIED");
    }
  }


  const position =
    await Geolocation.getCurrentPosition({

      enableHighAccuracy: true,

      timeout: 20000,

      maximumAge: 0

    });


  return {

    lat: position.coords.latitude,

    lng: position.coords.longitude,

    accuracy:
      position.coords.accuracy || 0

  };

}


/* ======================================================
   REVERSE GEOCODING
   ====================================================== */

async function reverse(lat, lng) {

  try {

    const url =
      `https://nominatim.openstreetmap.org/reverse` +
      `?format=jsonv2` +
      `&lat=${lat}` +
      `&lon=${lng}` +
      `&zoom=18` +
      `&addressdetails=1` +
      `&accept-language=ar`;

    const response =
      await fetch(url);

    const data =
      await response.json();


    return (
      data.display_name ||
      `موقع ${lat.toFixed(6)}, ${lng.toFixed(6)}`
    );


  } catch (error) {

    console.error(
      "REVERSE ERROR:",
      error
    );


    return `
      موقع ${lat.toFixed(6)},
      ${lng.toFixed(6)}
    `;

  }

}


/* ======================================================
   MAP MARKER
   ====================================================== */

function marker(type, point) {

  const icon =
    L.divIcon({

      className: "custom-marker",

      html: `
        <div class="${type}-marker">
          ${
            type === "pickup"
              ? "🚕"
              : "📍"
          }
        </div>
      `,

      iconSize: [48, 48],

      iconAnchor: [24, 42]

    });


  return L.marker(

    [
      point.lat,
      point.lng
    ],

    {
      icon
    }

  ).addTo(map);

}


/* ======================================================
   MAP CENTER CHANGED
   ====================================================== */

async function centerChanged() {

  if (!map) return;


  const center =
    map.getCenter();


  destination = {

    lat: center.lat,

    lng: center.lng

  };


  if (destMarker) {

    destMarker.setLatLng([
      center.lat,
      center.lng
    ]);

  } else {

    destMarker =
      marker(
        "destination",
        destination
      );

  }


  $("#coords").textContent =
    `${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}`;


  $("#address").textContent =
    "جاري تحديد العنوان...";


  const address =
    await reverse(
      center.lat,
      center.lng
    );


  $("#address").innerHTML = `
    🏁 <strong>
      ${esc(address)}
    </strong>
  `;


  drawRoute();

}


/* ======================================================
   INITIALIZE MAP
   ====================================================== */

function initMap() {

  if (map) {

    setTimeout(
      () => map.invalidateSize(),
      200
    );

    return;

  }


  const startCenter =
    pickup
      ? [
          pickup.lat,
          pickup.lng
        ]
      : [
          30.5526,
          31.0106
        ];


  map =
    L.map("map", {

      zoomControl: false

    }).setView(

      startCenter,

      pickup ? 18 : 13

    );


  L.tileLayer(

    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",

    {

      maxZoom: 20,

      attribution:
        "© OpenStreetMap contributors"

    }

  ).addTo(map);


  L.control.zoom({

    position: "bottomright"

  }).addTo(map);


  map.on(
    "moveend",
    centerChanged
  );


  if (pickup) {

    pickupMarker =
      marker(
        "pickup",
        pickup
      );

  }


  if (destination) {

    destMarker =
      marker(
        "destination",
        destination
      );


    map.setView(

      [
        destination.lat,
        destination.lng
      ],

      19

    );

  }

}


/* ======================================================
   SET PICKUP FROM PHONE LOCATION
   ====================================================== */

async function setPickup() {

  try {

    msg(
      "جاري تحديد موقعك بدقة... 📍",
      "info"
    );


    const point =
      await exactLocation();


    pickup = {

      lat: point.lat,

      lng: point.lng

    };


    /* ---------- PICKUP MARKER ---------- */

    if (pickupMarker) {

      pickupMarker.setLatLng([
        point.lat,
        point.lng
      ]);

    } else if (map) {

      pickupMarker =
        marker(
          "pickup",
          pickup
        );

    }


    /* ---------- ACCURACY CIRCLE ---------- */

    if (
      accuracyCircle &&
      map
    ) {

      accuracyCircle.remove();

    }


    if (map) {

      accuracyCircle =
        L.circle(

          [
            point.lat,
            point.lng
          ],

          {

            radius:
              Math.max(
                10,
                point.accuracy
              ),

            weight: 2,

            fillOpacity: 0.08

          }

        ).addTo(map);

    }


    /* ---------- ADDRESS ---------- */

    const address =
      await reverse(
        point.lat,
        point.lng
      );


    $("#pickupText").innerHTML = `

      📍 <strong>
        ${esc(address)}
      </strong>

      <br>

      <small>
        دقة GPS تقريباً
        ${Math.round(point.accuracy)}
        متر
      </small>

    `;


    /* ---------- MOVE MAP ---------- */

    if (map) {

      map.setView(

        [
          point.lat,
          point.lng
        ],

        19

      );

    }


    msg(
      "تم تحديد موقعك بدقة 📍",
      "success"
    );


  } catch (error) {

    console.error(
      "LOCATION ERROR:",
      error
    );


    msg(
      "اسمح للتطبيق بالموقع وشغّل GPS ثم حاول مرة أخرى.",
      "error"
    );

  }

}


/* ======================================================
   DRAW ROAD ROUTE
   ====================================================== */

async function drawRoute() {

  if (
    !pickup ||
    !destination ||
    !map
  ) {

    return;

  }


  try {

    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${pickup.lng},${pickup.lat};` +
      `${destination.lng},${destination.lat}` +
      `?overview=full&geometries=geojson`;


    const response =
      await fetch(url);


    const data =
      await response.json();


    if (!data.routes?.length) {

      return;

    }


    if (routeLayer) {

      routeLayer.remove();

    }


    routeLayer =
      L.geoJSON(

        data.routes[0].geometry,

        {

          style: {

            weight: 6,

            opacity: 0.85

          }

        }

      ).addTo(map);


  } catch (error) {

    console.error(
      "ROUTE ERROR:",
      error
    );

  }

}


/* ======================================================
   SEARCH PLACES IN EGYPT
   ====================================================== */

async function searchPlaces(q) {

  const box =
    $("#results");


  if (q.length < 3) {

    box.innerHTML = "";

    return;

  }


  box.innerHTML = `
    <div class="status">
      🔎 جاري البحث...
    </div>
  `;


  try {

    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?format=jsonv2` +
      `&q=${encodeURIComponent(q + ", Egypt")}` +
      `&limit=8` +
      `&addressdetails=1` +
      `&accept-language=ar` +
      `&countrycodes=eg`;


    const response =
      await fetch(url);


    const data =
      await response.json();


    if (!data.length) {

      box.innerHTML = `
        <div class="status">
          لا توجد نتائج.
        </div>
      `;

      return;

    }


    box.innerHTML =
      data.map(item => `

        <button
          class="search-result"
          data-lat="${item.lat}"
          data-lon="${item.lon}"
          data-name="${esc(item.display_name)}"
        >

          📍
          ${esc(item.display_name)}

        </button>

      `).join("");


    box
      .querySelectorAll(".search-result")
      .forEach(button => {

        button.onclick = () => {

          destination = {

            lat:
              Number(
                button.dataset.lat
              ),

            lng:
              Number(
                button.dataset.lon
              )

          };


          map.setView(

            [
              destination.lat,
              destination.lng
            ],

            19

          );


          $("#search").value =
            button.dataset.name;


          box.innerHTML = "";

        };

      });


  } catch (error) {

    console.error(
      "SEARCH ERROR:",
      error
    );


    box.innerHTML = `
      <div class="status">
        تعذر البحث.
      </div>
    `;

  }

}


/* ======================================================
   LOCATION BUTTONS
   ====================================================== */

$("#myLocation").onclick =
  async () => {

    await setPickup();

  };


$("#mapLocation").onclick =
  async () => {

    await setPickup();

  };


/* ======================================================
   OPEN DESTINATION MAP
   ====================================================== */

$("#chooseDest").onclick =
  () => {

    screen("mapScreen");


    setTimeout(() => {

      initMap();

      if (map) {

        map.invalidateSize();

      }

    }, 150);

  };


/* ======================================================
   CLOSE MAP
   ====================================================== */

$("#closeMap").onclick =
  () => {

    screen("home");

  };


/* ======================================================
   CONFIRM DESTINATION
   ====================================================== */

$("#confirmDest").onclick =
  async () => {

    if (!destination) {

      msg(
        "حدد مكان الوصول أولاً.",
        "error"
      );

      return;

    }


    const address =
      await reverse(

        destination.lat,

        destination.lng

      );


    $("#destText").innerHTML = `

      🏁 <strong>
        ${esc(address)}
      </strong>

    `;


    screen("home");


    msg(
      "تم تحديد مكان الوصول بدقة ✅",
      "success"
    );

  };


/* ======================================================
   SEARCH INPUT
   ====================================================== */

let searchTimer;


$("#search").oninput =
  () => {

    clearTimeout(
      searchTimer
    );


    searchTimer =
      setTimeout(() => {

        searchPlaces(
          $("#search").value.trim()
        );

      }, 650);

  };


/* ======================================================
   DAY PREVIEW
   ====================================================== */

$("#rideDate").onchange =
  () => {

    const date =
      $("#rideDate").value;


    $("#dayPreview").textContent =
      dayName(date)
        ? `📆 ${dayName(date)}`
        : "";

  };
/* ======================================================
   PART 6 — RIDES + CUSTOMER/CAPTAIN PROFILES
   ====================================================== */


/* ======================================================
   CUSTOMER RIDE CARD
   ====================================================== */

function customerCard(ride) {

  const captainAccepted =
    ride.status !== "open" &&
    ride.captainId;


  return `
    <div class="ride-card">

      <div class="ride-top">

        <div class="ride-person">

          ${avatarHTML(
            ride.customerName || profile?.name || "العميل",
            ride.customerPhoto || profile?.photoURL || "",
            58
          )}

          <div>
            <strong>
              ${esc(
                ride.customerName ||
                profile?.name ||
                "العميل"
              )}
            </strong>

            <small>
              👤 صاحب الرحلة
            </small>
          </div>

        </div>

        <span class="ride-status">
          ${esc(statusText(ride.status))}
        </span>

      </div>


      <div class="ride-route">

        <div>
          📍
          <strong>من</strong>
          <span>
            ${esc(ride.pickupAddress || "موقع الانطلاق")}
          </span>
        </div>

        <div>
          🏁
          <strong>إلى</strong>
          <span>
            ${esc(ride.destinationAddress || "مكان الوصول")}
          </span>
        </div>

      </div>


      <div class="ride-details">

        <span>
          📅 ${esc(formatDate(ride.rideDate))}
        </span>

        <span>
          🕐 ${esc(ride.rideTime || "")}
        </span>

        <span>
          👥 ${esc(ride.passengers || 1)}
        </span>

        <span>
          💰 ${esc(ride.price || 0)} جنيه
        </span>

      </div>


      ${
        ride.notes
          ? `
            <div class="ride-notes">
              📝 ${esc(ride.notes)}
            </div>
          `
          : ""
      }


      ${
        captainAccepted
          ? `
            <div class="captain-box">

              <div class="captain-title">
                🚗 الكابتن المقبول
              </div>

              <div class="captain-profile">

                ${avatarHTML(
                  ride.captainName || "الكابتن",
                  ride.captainPhoto || "",
                  70
                )}

                <div class="captain-data">

                  <strong>
                    ${esc(
                      ride.captainName ||
                      "الكابتن"
                    )}
                  </strong>

                  <div>
                    📱
                    ${esc(
                      ride.captainPhone ||
                      ""
                    )}
                  </div>

                  <div>
                    🚘
                    ${esc(
                      ride.captainCarType ||
                      ""
                    )}
                    -
                    ${esc(
                      ride.captainCarModel ||
                      ""
                    )}
                  </div>

                  <div>
                    🔢
                    ${esc(
                      ride.captainPlate ||
                      ""
                    )}
                  </div>

                </div>

              </div>

            </div>
          `
          : `
            <div class="waiting-box">
              ⏳ في انتظار قبول كابتن للرحلة
            </div>
          `
      }

    </div>
  `;

}


/* ======================================================
   LOAD CUSTOMER RIDES
   ====================================================== */

function loadCustomerRides() {

  if (!user) return;


  if (watchCustomer) {

    watchCustomer();

    watchCustomer = null;

  }


  const ridesRef =
    collection(db, "rides");


  const q =
    query(
      ridesRef,
      where("customerId", "==", user.uid),
      limit(50)
    );


  watchCustomer =
    onSnapshot(

      q,

      snapshot => {

        const rides =
          snapshot.docs.map(
            d => ({
              id: d.id,
              ...d.data()
            })
          );


        rides.sort(
          (a, b) =>
            (b.createdAt?.seconds || 0) -
            (a.createdAt?.seconds || 0)
        );


        const box =
          $("#ridesList");


        if (!box) return;


        if (!rides.length) {

          box.innerHTML = `
            <div class="empty-card">
              <div>🚕</div>
              <strong>لسه مفيش رحلات</strong>
              <p>
                لما تطلب رحلة هتظهر هنا.
              </p>
            </div>
          `;

          return;

        }


        box.innerHTML =
          rides
            .map(customerCard)
            .join("");

      },

      error => {

        console.error(
          "CUSTOMER RIDES ERROR:",
          error
        );


        msg(
          "تعذر تحميل رحلاتك.",
          "error"
        );

      }

    );

}


/* ======================================================
   CAPTAIN OPEN RIDE CARD
   ====================================================== */

function captainOpenCard(ride) {

  return `
    <div class="ride-card captain-ride">

      <div class="ride-top">

        <div class="ride-person">

          ${avatarHTML(
            ride.customerName || "العميل",
            ride.customerPhoto || "",
            58
          )}

          <div>

            <strong>
              ${esc(
                ride.customerName ||
                "العميل"
              )}
            </strong>

            <small>
              👤 صاحب الرحلة
            </small>

          </div>

        </div>

        <span class="ride-status">
          بانتظار كابتن
        </span>

      </div>


      <div class="ride-route">

        <div>
          📍
          <strong>من</strong>

          <span>
            ${esc(
              ride.pickupAddress ||
              "موقع الانطلاق"
            )}
          </span>
        </div>


        <div>
          🏁
          <strong>إلى</strong>

          <span>
            ${esc(
              ride.destinationAddress ||
              "مكان الوصول"
            )}
          </span>
        </div>

      </div>


      <div class="ride-details">

        <span>
          📅
          ${esc(
            formatDate(
              ride.rideDate
            )
          )}
        </span>

        <span>
          🕐
          ${esc(
            ride.rideTime || ""
          )}
        </span>

        <span>
          👥
          ${esc(
            ride.passengers || 1
          )}
        </span>

        <span>
          💰
          ${esc(
            ride.price || 0
          )}
          جنيه
        </span>

      </div>


      ${
        ride.notes
          ? `
            <div class="ride-notes">
              📝 ${esc(ride.notes)}
            </div>
          `
          : ""
      }


      <div class="customer-contact">

        <strong>
          بيانات العميل
        </strong>

        <div>
          👤
          ${esc(
            ride.customerName ||
            ""
          )}
        </div>

        <div>
          📱
          ${esc(
            ride.customerPhone ||
            ""
          )}
        </div>

      </div>


      <button
        class="btn green accept-ride-btn"
        data-id="${esc(ride.id)}"
      >
        🚗 قبول الرحلة
      </button>

    </div>
  `;

}


/* ======================================================
   CAPTAIN ACCEPTED RIDE CARD
   ====================================================== */

function captainAcceptedCard(ride) {

  return `
    <div class="ride-card captain-accepted">

      <div class="ride-top">

        <div class="ride-person">

          ${avatarHTML(
            ride.customerName || "العميل",
            ride.customerPhoto || "",
            58
          )}

          <div>

            <strong>
              ${esc(
                ride.customerName ||
                "العميل"
              )}
            </strong>

            <small>
              👤 العميل
            </small>

          </div>

        </div>

        <span class="ride-status">
          ${esc(
            statusText(
              ride.status
            )
          )}
        </span>

      </div>


      <div class="ride-route">

        <div>
          📍
          <strong>من</strong>

          <span>
            ${esc(
              ride.pickupAddress ||
              ""
            )}
          </span>
        </div>

        <div>
          🏁
          <strong>إلى</strong>

          <span>
            ${esc(
              ride.destinationAddress ||
              ""
            )}
          </span>
        </div>

      </div>


      <div class="ride-details">

        <span>
          📅
          ${esc(
            formatDate(
              ride.rideDate
            )
          )}
        </span>

        <span>
          🕐
          ${esc(
            ride.rideTime || ""
          )}
        </span>

        <span>
          👥
          ${esc(
            ride.passengers || 1
          )}
        </span>

        <span>
          💰
          ${esc(
            ride.price || 0
          )}
          جنيه
        </span>

      </div>


      <div class="customer-contact">

        <strong>
          بيانات العميل
        </strong>

        <div>
          👤
          ${esc(
            ride.customerName ||
            ""
          )}
        </div>

        <div>
          📱
          ${esc(
            ride.customerPhone ||
            ""
          )}
        </div>

      </div>


      <div class="captain-self-box">

        ${avatarHTML(
          ride.captainName ||
          profile?.name ||
          "الكابتن",

          ride.captainPhoto ||
          profile?.photoURL ||
          "",

          52
        )}

        <div>

          <strong>
            ${esc(
              ride.captainName ||
              profile?.name ||
              ""
            )}
          </strong>

          <small>
            🚗
            ${esc(
              ride.captainCarType ||
              profile?.carType ||
              ""
            )}

            -

            ${esc(
              ride.captainCarModel ||
              profile?.carModel ||
              ""
            )}
          </small>

        </div>

      </div>

    </div>
  `;

}


/* ======================================================
   LOAD CAPTAIN
   ====================================================== */

function loadCaptain() {

  if (!user) return;


  loadCaptainOpenRides();

  loadCaptainAccepted();

  updateCaptainState();

}


/* ======================================================
   OPEN RIDES FOR CAPTAIN
   ====================================================== */

function loadCaptainOpenRides() {

  if (!user) return;


  if (watchRides) {

    watchRides();

    watchRides = null;

  }


  const q =
    query(
      collection(db, "rides"),
      where("status", "==", "open"),
      limit(50)
    );


  watchRides =
    onSnapshot(

      q,

      snapshot => {

        const rides =
          snapshot.docs.map(
            d => ({
              id: d.id,
              ...d.data()
            })
          );


        rides.sort(
          (a, b) =>
            (b.createdAt?.seconds || 0) -
            (a.createdAt?.seconds || 0)
        );


        const box =
          $("#captainList");


        if (!box) return;


        if (!rides.length) {

          box.innerHTML = `
            <div class="empty-card">

              <div>🚗</div>

              <strong>
                مفيش رحلات جديدة حالياً
              </strong>

              <p>
                لما عميل ينشر رحلة هتظهر هنا.
              </p>

            </div>
          `;

          return;

        }


        box.innerHTML =
          rides
            .map(captainOpenCard)
            .join("");


        bindCaptainActions();

      },

      error => {

        console.error(
          "CAPTAIN OPEN RIDES ERROR:",
          error
        );

        msg(
          "تعذر تحميل الرحلات الجديدة.",
          "error"
        );

      }

    );

}


/* ======================================================
   LOAD CAPTAIN ACCEPTED RIDES
   ====================================================== */

function loadCaptainAccepted() {

  if (!user) return;


  if (watchCaptainAccepted) {

    watchCaptainAccepted();

    watchCaptainAccepted = null;

  }


  const q =
    query(
      collection(db, "rides"),
      where(
        "captainId",
        "==",
        user.uid
      ),
      limit(50)
    );


  watchCaptainAccepted =
    onSnapshot(

      q,

      snapshot => {

        const rides =
          snapshot.docs.map(
            d => ({
              id: d.id,
              ...d.data()
            })
          );


        rides.sort(
          (a, b) =>
            (b.acceptedAt?.seconds || 0) -
            (a.acceptedAt?.seconds || 0)
        );


        const box =
          $("#captainAcceptedList");


        if (!box) return;


        if (!rides.length) {

          box.innerHTML = `
            <div class="empty-card">

              <div>📋</div>

              <strong>
                لم تقبل أي رحلة بعد
              </strong>

            </div>
          `;

          return;

        }


        box.innerHTML =
          rides
            .map(
              captainAcceptedCard
            )
            .join("");

      },

      error => {

        console.error(
          "CAPTAIN ACCEPTED ERROR:",
          error
        );

      }

    );

}


/* ======================================================
   BIND ACCEPT BUTTONS
   ====================================================== */

function bindCaptainActions() {

  document
    .querySelectorAll(
      ".accept-ride-btn"
    )
    .forEach(button => {

      button.onclick =
        async () => {

          const rideId =
            button.dataset.id;


          await acceptRide(
            rideId,
            button
          );

        };

    });

}


/* ======================================================
   ACCEPT RIDE
   ====================================================== */

async function acceptRide(
  rideId,
  button
) {

  if (!user) {

    msg(
      "سجل الدخول ككابتن أولاً.",
      "error"
    );

    return;

  }


  if (
    profile?.role !== "captain"
  ) {

    msg(
      "الحساب الحالي ليس حساب كابتن.",
      "error"
    );

    return;

  }


  try {

    button.disabled = true;

    button.textContent =
      "جاري قبول الرحلة...";


    const rideRef =
      doc(
        db,
        "rides",
        rideId
      );


    await runTransaction(
      db,
      async transaction => {

        const rideSnap =
          await transaction.get(
            rideRef
          );


        if (!rideSnap.exists()) {

          throw new Error(
            "RIDE_NOT_FOUND"
          );

        }


        const ride =
          rideSnap.data();


        if (
          ride.status !== "open"
        ) {

          throw new Error(
            "RIDE_ALREADY_ACCEPTED"
          );

        }


        const captainName =
          profile.name ||
          "الكابتن";


        const captainPhone =
          profile.phone ||
          "";


        transaction.update(

          rideRef,

          {

            status:
              "accepted",

            captainId:
              user.uid,

            captainName:
              captainName,

            captainPhoto:
              profile.photoURL ||
              "",

            captainPhone:
              captainPhone,

            captainAge:
              profile.age ||
              "",

            captainCarType:
              profile.carType ||
              "",

            captainCarModel:
              profile.carModel ||
              "",

            captainPlate:
              profile.plateNumber ||
              "",

            acceptedAt:
              serverTimestamp()

          }

        );

      }

    );


    msg(
      "تم قبول الرحلة بنجاح 🚗✅",
      "success"
    );


  } catch (error) {

    console.error(
      "ACCEPT RIDE ERROR:",
      error
    );


    if (
      error.message ===
      "RIDE_ALREADY_ACCEPTED"
    ) {

      msg(
        "الرحلة دي اتقبلت بالفعل من كابتن آخر.",
        "error"
      );

    } else if (
      error.message ===
      "RIDE_NOT_FOUND"
    ) {

      msg(
        "الرحلة غير موجودة.",
        "error"
      );

    } else {

      msg(
        "تعذر قبول الرحلة. حاول مرة أخرى.",
        "error"
      );

    }

  } finally {

    button.disabled = false;

    button.textContent =
      "🚗 قبول الرحلة";

  }

}


/* ======================================================
   PUBLISH CUSTOMER RIDE
   ====================================================== */

$("#request").onclick =
  async () => {

    if (!user) {

      msg(
        "سجل الدخول أولاً.",
        "error"
      );

      return;

    }


    if (
      profile?.role !== "customer"
    ) {

      msg(
        "لازم تستخدم حساب عميل لطلب رحلة.",
        "error"
      );

      return;

    }


    if (!pickup) {

      msg(
        "حدد مكان الانطلاق أولاً.",
        "error"
      );

      return;

    }


    if (!destination) {

      msg(
        "حدد مكان الوصول أولاً.",
        "error"
      );

      return;

    }


    const rideDate =
      $("#rideDate").value;


    const rideTime =
      $("#rideTime").value;


    const passengers =
      Number(
        $("#passengers").value
      );


    const price =
      Number(
        $("#price").value
      );


    const notes =
      $("#notes").value.trim();


    if (!rideDate) {

      msg(
        "اختار يوم الرحلة.",
        "error"
      );

      return;

    }


    if (!rideTime) {

      msg(
        "اختار وقت الرحلة.",
        "error"
      );

      return;

    }


    if (
      !price ||
      price < 1
    ) {

      msg(
        "اكتب السعر المقترح.",
        "error"
      );

      return;

    }


    const button =
      $("#request");


    try {

      button.disabled = true;

      button.textContent =
        "جاري نشر الرحلة...";


      const pickupAddress =
        await reverse(
          pickup.lat,
          pickup.lng
        );


      const destinationAddress =
        await reverse(
          destination.lat,
          destination.lng
        );


      const rideData = {

        customerId:
          user.uid,

        customerName:
          profile.name ||
          "العميل",

        customerPhoto:
          profile.photoURL ||
          "",

        customerPhone:
          profile.phone ||
          "",


        pickup: {

          lat:
            pickup.lat,

          lng:
            pickup.lng

        },


        destination: {

          lat:
            destination.lat,

          lng:
            destination.lng

        },


        pickupAddress:
          pickupAddress,

        destinationAddress:
          destinationAddress,


        rideDate:
          rideDate,

        rideTime:
          rideTime,


        passengers:
          passengers,


        price:
          price,


        notes:
          notes,


        status:
          "open",


        captainId:
          "",

        captainName:
          "",

        captainPhoto:
          "",

        captainPhone:
          "",

        captainCarType:
          "",

        captainCarModel:
          "",

        captainPlate:
          "",


        createdAt:
          serverTimestamp()

      };


      await addDoc(
        collection(db, "rides"),
        rideData
      );


      msg(
        "تم نشر الرحلة للكباتن 🚕✅",
        "success"
      );


      $("#price").value = "";

      $("#notes").value = "";


      screen("rides");


      loadCustomerRides();


    } catch (error) {

      console.error(
        "CREATE RIDE ERROR:",
        error
      );


      msg(
        "تعذر نشر الرحلة. حاول مرة أخرى.",
        "error"
      );

    } finally {

      button.disabled = false;

      button.textContent =
        "🚕 نشر الرحلة للكباتن";

    }

  };


/* ======================================================
   CAPTAIN AVAILABILITY
   ====================================================== */

async function setCaptainAvailability(
  status
) {

  if (!user) return;


  if (
    profile?.role !== "captain"
  ) return;


  try {

    await updateDoc(

      doc(
        db,
        "users",
        user.uid
      ),

      {

        captainStatus:
          status

      }

    );


    profile.captainStatus =
      status;


    updateCaptainState();


    msg(

      status === "available"
        ? "أنت الآن متاح للرحلات 🟢"
        : "تم إيقاف استقبال الرحلات ⚫",

      "success"

    );


  } catch (error) {

    console.error(
      "CAPTAIN STATUS ERROR:",
      error
    );


    msg(
      "تعذر تغيير حالة الكابتن.",
      "error"
    );

  }

}


function updateCaptainState() {

  const state =
    $("#captainState");


  if (!state) return;


  if (
    profile?.captainStatus ===
    "available"
  ) {

    state.innerHTML =
      "🟢 <strong>متاح لاستقبال الرحلات</strong>";

  } else {

    state.innerHTML =
      "⚫ <strong>غير متاح حالياً</strong>";

  }

}


$("#captainAvailable").onclick =
  () =>
    setCaptainAvailability(
      "available"
    );


$("#captainUnavailable").onclick =
  () =>
    setCaptainAvailability(
      "unavailable"
    );
/* ======================================================
   PART 7 — NAVIGATION + AUTH + APP START
   ====================================================== */


/* ======================================================
   NAVIGATION
   ====================================================== */

$("#navHome").onclick = () => {

  if (!user) {
    screen("login");
    return;
  }

  if (profile?.role === "captain") {

    screen("captain");

    loadCaptain();

  } else {

    screen("home");

    loadCustomerRides();

  }

};


$("#navRides").onclick = () => {

  if (!user) {
    screen("login");
    return;
  }

  if (profile?.role === "captain") {

    screen("captain");

    loadCaptain();

  } else {

    screen("rides");

    loadCustomerRides();

  }

};


$("#navCaptain").onclick = () => {

  if (!user) {

    screen("login");

    return;

  }

  if (
    profile?.role !== "captain"
  ) {

    msg(
      "قسم الكابتن مخصص لحسابات الكباتن فقط.",
      "error"
    );

    return;

  }

  screen("captain");

  loadCaptain();

};


$("#navProfile").onclick = async () => {

  if (!user) {

    screen("login");

    return;

  }

  await loadProfile();

  screen("profile");

};


$("#profileTop").onclick = async () => {

  if (!user) {

    screen("login");

    return;

  }

  await loadProfile();

  screen("profile");

};


/* ======================================================
   DEFAULT DATE / TIME
   ====================================================== */

function setDefaultRideDateTime() {

  const dateInput =
    $("#rideDate");

  const timeInput =
    $("#rideTime");


  if (!dateInput || !timeInput)
    return;


  const now =
    new Date();


  const year =
    now.getFullYear();


  const month =
    String(
      now.getMonth() + 1
    ).padStart(2, "0");


  const day =
    String(
      now.getDate()
    ).padStart(2, "0");


  dateInput.value =
    `${year}-${month}-${day}`;


  const hours =
    String(
      now.getHours()
    ).padStart(2, "0");


  const minutes =
    String(
      now.getMinutes()
    ).padStart(2, "0");


  timeInput.value =
    `${hours}:${minutes}`;


  $("#dayPreview").textContent =
    `📆 ${dayName(dateInput.value)}`;

}


setDefaultRideDateTime();


/* ======================================================
   CLEAN MAP WHEN LEAVING MAP SCREEN
   ====================================================== */

function refreshMapSize() {

  if (!map) return;

  setTimeout(() => {

    try {

      map.invalidateSize();

    } catch (e) {

      console.error(
        "MAP REFRESH ERROR:",
        e
      );

    }

  }, 200);

}


/* ======================================================
   SCREEN HELPER OVERRIDE
   ====================================================== */

const originalScreen =
  screen;





/* ======================================================
   AUTH STATE
   ====================================================== */

onAuthStateChanged(
  auth,
  async currentUser => {

    try {

      if (!currentUser) {

        user = null;

        profile = null;


        if (watchRides) {

          watchRides();

          watchRides = null;

        }


        if (watchCustomer) {

          watchCustomer();

          watchCustomer = null;

        }


        if (watchCaptainAccepted) {

          watchCaptainAccepted();

          watchCaptainAccepted = null;

        }


        screen("login");

        return;

      }


      user =
        currentUser;


      await loadProfile();


      if (!profile) {

        msg(
          "لم يتم العثور على بيانات الحساب.",
          "error"
        );

        await signOut(auth);

        return;

      }


      if (
        profile.role ===
        "captain"
      ) {

        screen("captain");

        loadCaptain();

      } else {

        screen("home");

        loadCustomerRides();

      }


    } catch (error) {

      console.error(
        "AUTH STATE ERROR:",
        error
      );


      msg(
        "حدث خطأ أثناء تحميل الحساب.",
        "error"
      );

    }

  }
);


/* ======================================================
   INITIAL UI STATE
   ====================================================== */

(function initUI() {

  try {

    const role =
      $("#role");

    if (role) {

      $("#captainFields").style.display =
        role.value === "captain"
          ? "block"
          : "none";

    }


    if ($("#nav")) {

      $("#nav").style.display =
        "none";

    }


    screen("login");


  } catch (error) {

    console.error(
      "INIT UI ERROR:",
      error
    );

  }

})();
