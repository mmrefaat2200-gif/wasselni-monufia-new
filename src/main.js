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
  signOut,
  deleteUser
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

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "firebase/storage";

import { Geolocation } from "@capacitor/geolocation";


/* =========================================================
   FIREBASE
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyD1w6MD5QYYIOn0QLz5r8KqXo8z8WRjJKs",
  authDomain: "wasselni-monufia-ac5fc.firebaseapp.com",
  projectId: "wasselni-monufia-ac5fc",
  storageBucket: "wasselni-monufia-ac5fc.firebasestorage.app",
  messagingSenderId: "1079664487535",
  appId: "1:1079664487535:web:4de61934fa993aca81f19a"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getFirestore(app);

const storage = getStorage(app);

setPersistence(auth, browserLocalPersistence).catch(console.error);


/* =========================================================
   STATE
   ========================================================= */

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

let authBusy = false;


/* =========================================================
   HELPERS
   ========================================================= */

const $ = (selector) => document.querySelector(selector);

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


/* =========================================================
   PHONE
   ========================================================= */

function phone(value) {
  let v = String(value || "")
    .trim()
    .replace(/[\s()-]/g, "");

  if (v.startsWith("00")) {
    v = "+" + v.slice(2);
  }

  if (v.startsWith("+20")) {
    return v;
  }

  if (v.startsWith("20") && v.length === 12) {
    return "+" + v;
  }

  if (v.startsWith("01") && v.length === 11) {
    return "+20" + v.slice(1);
  }

  return v;
}


/* =========================================================
   INTERNAL FIREBASE EMAIL
   مهم جداً:
   العميل والكابتن لهم حسابين منفصلين حتى لو نفس الرقم
   ========================================================= */

function loginEmail(phoneNumber, role) {
  const digits = phone(phoneNumber).replace(/\D/g, "");

  const roleName =
    role === "captain"
      ? "captain"
      : "customer";

  return `${digits}.${roleName}@login.wasselni-monufia.app`;
}


/* =========================================================
   LEGACY ACCOUNT
   لدعم بعض الحسابات القديمة إن وجدت
   ========================================================= */

function legacyLoginEmail(phoneNumber) {
  const digits = String(phoneNumber || "").replace(/\D/g, "");

  if (digits.startsWith("01") && digits.length === 11) {
    return `${digits}@phone.wasselni.app`;
  }

  return "";
}


/* =========================================================
   ACCOUNT NUMBER
   ========================================================= */

function accountNo() {
  return String(
    Math.floor(10000000 + Math.random() * 90000000)
  );
}


/* =========================================================
   MESSAGE
   ========================================================= */

function msg(text, type = "info") {
  const element = $("#message");

  if (!element) return;

  element.textContent = text;
  element.className = `message-box ${type}`;
  element.style.display = "block";

  clearTimeout(window.__msg);

  window.__msg = setTimeout(() => {
    element.style.display = "none";
  }, 4500);
}


/* =========================================================
   SCREEN
   ========================================================= */

function screen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((x) => x.classList.remove("active"));

  $("#" + id)?.classList.add("active");

  if ($("#nav")) {
    $("#nav").style.display =
      ["login", "register"].includes(id)
        ? "none"
        : "flex";
  }
}


/* =========================================================
   STATUS
   ========================================================= */

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


/* =========================================================
   DATE
   ========================================================= */

function dayName(date) {
  if (!date) return "";

  return new Intl.DateTimeFormat("ar-EG", {
    weekday: "long"
  }).format(new Date(`${date}T12:00:00`));
}


function formatDate(value) {
  if (!value) return "";

  return new Intl.DateTimeFormat("ar-EG", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(`${value}T12:00:00`));
}


/* =========================================================
   APP HTML
   ========================================================= */

$("#app").innerHTML = `
<div class="app">

<header class="header">
  <div class="logo">
    🚕 وصلني <span>المنوفية</span>
  </div>

  <button id="profileTop" class="icon-button">
    👤
  </button>
</header>

<div id="message" class="message-box" style="display:none"></div>


<!-- LOGIN -->

<section id="login" class="screen active">

  <div class="auth-card">

    <div class="auth-logo">
      🚕
    </div>

    <h1>
      وصلني المنوفية
    </h1>

    <p class="muted">
      تسجيل الدخول برقم الموبايل وكلمة المرور
    </p>


    <label>
      نوع الحساب
    </label>

    <select id="loginRole">

      <option value="customer">
        👤 عميل
      </option>

      <option value="captain">
        🚗 كابتن
      </option>

    </select>


    <label>
      📱 رقم الموبايل
    </label>

    <input
      id="loginPhone"
      type="tel"
      inputmode="tel"
      placeholder="010xxxxxxxx"
    />


    <label>
      🔐 كلمة المرور
    </label>

    <input
      id="loginPass"
      type="password"
      placeholder="كلمة المرور"
    />


    <button
      id="loginBtn"
      class="btn primary"
    >
      تسجيل الدخول
    </button>


    <button
      id="registerOpen"
      class="btn outline"
    >
      إنشاء حساب جديد
    </button>


    <div
      id="loginMsg"
      class="status"
    ></div>

  </div>

</section>


<!-- REGISTER -->

<section id="register" class="screen">

  <div class="auth-card">

    <button
      id="backLogin"
      class="back-btn"
    >
      ← رجوع
    </button>

    <h2>
      إنشاء حساب
    </h2>


    <label>
      نوع الحساب
    </label>

    <select id="role">

      <option value="customer">
        👤 عميل
      </option>

      <option value="captain">
        🚗 كابتن
      </option>

    </select>


    <label>
      الاسم بالكامل
    </label>

    <input
      id="name"
      placeholder="الاسم"
    />


    <label>
      📷 صورة الحساب
    </label>

    <input
      id="profilePhoto"
      type="file"
      accept="image/*"
    />

    <small class="muted">
      اختياري — يفضل صورة واضحة للوجه.
    </small>


    <label>
      📱 رقم الموبايل
    </label>

    <input
      id="regPhone"
      type="tel"
      inputmode="tel"
      placeholder="010xxxxxxxx"
    />


    <label>
      🔐 كلمة المرور
    </label>

    <input
      id="regPass"
      type="password"
      placeholder="6 أحرف أو أرقام على الأقل"
    />


    <label>
      🔐 تأكيد كلمة المرور
    </label>

    <input
      id="regPass2"
      type="password"
      placeholder="تأكيد كلمة المرور"
    />


    <div
      id="captainFields"
      style="display:none"
    >

      <label>
        🎂 السن
      </label>

      <input
        id="age"
        type="number"
        min="18"
        placeholder="السن"
      />


      <label>
        🚗 نوع العربية
      </label>

      <input
        id="carType"
        placeholder="سيدان / ميكروباص / نص نقل"
      />


      <label>
        🚘 موديل العربية
      </label>

      <input
        id="carModel"
        placeholder="مثال: لانسر 2018"
      />


      <label>
        🔢 رقم اللوحة
      </label>

      <input
        id="plate"
        placeholder="رقم اللوحة"
      />

    </div>


    <button
      id="finishReg"
      class="btn green"
    >
      إنشاء الحساب
    </button>


    <div
      id="regMsg"
      class="status"
    ></div>

  </div>

</section>


<!-- CUSTOMER HOME -->

<section id="home" class="screen">

  <div class="hero">

    <h2>
      أهلاً بيك 👋
    </h2>

    <p>
      اطلب رحلتك وحدد كل التفاصيل.
    </p>

  </div>


  <div class="card">

    <label>
      📍 الانطلاق
    </label>

    <button
      id="myLocation"
      class="btn outline"
    >
      🎯 تحديد موقعي بدقة
    </button>

    <div
      id="pickupText"
      class="status"
    >
      لم يتم تحديد موقعك
    </div>

  </div>


  <div class="card">

    <label>
      🏁 الوصول
    </label>

    <button
      id="chooseDest"
      class="btn outline"
    >
      🗺️ تحديد مكان النزول على الخريطة
    </button>

    <div
      id="destText"
      class="status"
    >
      لم يتم تحديد مكان الوصول
    </div>

  </div>


  <div class="card">

    <label>
      📅 يوم الرحلة
    </label>

    <input
      id="rideDate"
      type="date"
    />

    <div
      id="dayPreview"
      class="status"
    ></div>


    <label>
      🕐 وقت الرحلة
    </label>

    <input
      id="rideTime"
      type="time"
    />


    <label>
      👥 عدد الركاب
    </label>

    <select id="passengers">

      ${Array.from(
        { length: 8 },
        (_, i) =>
          `<option value="${i + 1}">
            ${i + 1}
          </option>`
      ).join("")}

    </select>


    <label>
      💰 السعر المقترح
    </label>

    <input
      id="price"
      type="number"
      min="1"
      placeholder="مثال 150"
    />


    <label>
      📝 الرسالة / الملاحظات
    </label>

    <textarea
      id="notes"
      rows="3"
      placeholder="شنطة كبيرة، طفل، شارع ضيق، أي ملاحظة للكابتن..."
    ></textarea>


    <button
      id="request"
      class="btn primary"
    >
      🚕 نشر الرحلة للكباتن
    </button>

  </div>

</section>


<!-- MAP -->

<section
  id="mapScreen"
  class="screen"
>

  <div class="card">

    <div class="map-head">

      <div>

        <h2>
          🗺️ تحديد المكان
        </h2>

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
    />


    <div
      id="results"
      class="search-results"
    ></div>

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

    <div
      id="address"
      class="status"
    >
      حدد المكان.
    </div>

    <div
      id="coords"
      class="coords"
    ></div>

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

    <h2>
      📋 رحلاتي
    </h2>

    <p>
      تابع الرحلة من النشر حتى الانتهاء.
    </p>

  </div>

  <div id="ridesList"></div>

</section>


<!-- CAPTAIN -->

<section id="captain" class="screen">

  <div class="hero">

    <h2>
      🚗 منصة الكابتن
    </h2>

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

    <div
      id="captainState"
      class="status"
    ></div>

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

  <div class="card">

    <div class="avatar">
      👤
    </div>

    <h2>
      حسابي
    </h2>

    <div id="profileInfo"></div>

    <button
      id="logout"
      class="btn danger"
    >
      تسجيل الخروج
    </button>

  </div>

</section>


<!-- NAV -->

<nav
  id="nav"
  class="nav"
>

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


/* =========================================================
   LOCATION
   ========================================================= */

async function exactLocation() {

  const permission =
    await Geolocation.checkPermissions();

  if (permission.location !== "granted") {

    const result =
      await Geolocation.requestPermissions();

    if (result.location !== "granted") {
      throw Error("LOCATION_DENIED");
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
    accuracy: position.coords.accuracy
  };
}


/* =========================================================
   REVERSE GEOCODING
   ========================================================= */

async function reverse(lat, lng) {

  try {

    const response =
      await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=ar`
      );

    const data = await response.json();

    return (
      data.display_name ||
      `موقع ${lat.toFixed(6)}, ${lng.toFixed(6)}`
    );

  } catch {

    return `موقع ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
}


/* =========================================================
   MAP MARKER
   ========================================================= */

function marker(type, point) {

  const icon = L.divIcon({

    className: "custom-marker",

    html: `
      <div class="${type}-marker">
        ${type === "pickup" ? "🚕" : "📍"}
      </div>
    `,

    iconSize: [48, 48],

    iconAnchor: [24, 42]
  });

  return L.marker(
    [point.lat, point.lng],
    { icon }
  ).addTo(map);
}


/* =========================================================
   MAP CENTER
   ========================================================= */

async function centerChanged() {

  if (!map) return;

  const center = map.getCenter();

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
      marker("destination", destination);
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


  $("#address").innerHTML =
    `🏁 <strong>${esc(address)}</strong>`;


  drawRoute();
}


/* =========================================================
   INIT MAP
   ========================================================= */

function initMap() {

  if (map) {

    setTimeout(
      () => map.invalidateSize(),
      200
    );

    return;
  }


  map = L.map("map", {
    zoomControl: false
  }).setView(
    pickup
      ? [pickup.lat, pickup.lng]
      : [30.5526, 31.0106],
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
      marker("pickup", pickup);
  }


  if (destination) {

    destMarker =
      marker("destination", destination);

    map.setView(
      [
        destination.lat,
        destination.lng
      ],
      19
    );
  }
}


/* =========================================================
   SET PICKUP
   ========================================================= */

async function setPickup() {

  try {

    const point =
      await exactLocation();

    pickup = {
      lat: point.lat,
      lng: point.lng
    };


    if (pickupMarker) {

      pickupMarker.setLatLng([
        point.lat,
        point.lng
      ]);

    } else if (map) {

      pickupMarker =
        marker("pickup", pickup);
    }


    if (accuracyCircle && map) {
      accuracyCircle.remove();
    }


    if (map) {

      accuracyCircle =
        L.circle(
          [point.lat, point.lng],
          {
            radius:
              Math.max(10, point.accuracy),
            weight: 2,
            fillOpacity: 0.08
          }
        ).addTo(map);
    }


    const address =
      await reverse(
        point.lat,
        point.lng
      );


    $("#pickupText").innerHTML =
      `
        📍 <strong>${esc(address)}</strong>
        <br>
        <small>
          دقة GPS تقريباً
          ${Math.round(point.accuracy)}
          متر
        </small>
      `;


    if (map) {

      map.setView(
        [point.lat, point.lng],
        19
      );
    }


    msg(
      "تم تحديد موقعك بدقة 📍",
      "success"
    );

  } catch (error) {

    console.error(error);

    msg(
      "اسمح للتطبيق بالموقع وشغّل GPS ثم حاول مرة أخرى.",
      "error"
    );
  }
}


/* =========================================================
   ROUTE
   ========================================================= */

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
      `https://router.project-osrm.org/route/v1/driving/${pickup.lng},${pickup.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;


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

    console.error(error);
  }
}


/* =========================================================
   SEARCH PLACES
   ========================================================= */

async function searchPlaces(queryText) {

  const box = $("#results");

  if (queryText.length < 3) {

    box.innerHTML = "";

    return;
  }


  box.innerHTML =
    "<div class='status'>🔎 جاري البحث...</div>";


  try {

    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(queryText + ", Egypt")}&limit=8&addressdetails=1&accept-language=ar&countrycodes=eg`;


    const response =
      await fetch(url);

    const data =
      await response.json();


    box.innerHTML =
      data.length
        ? data
            .map(
              (item) =>
                `
                <button
                  class="search-result"
                  data-lat="${item.lat}"
                  data-lon="${item.lon}"
                  data-name="${esc(item.display_name)}"
                >
                  📍 ${esc(item.display_name)}
                </button>
                `
            )
            .join("")
        : "<div class='status'>لا توجد نتائج.</div>";


    box
      .querySelectorAll(".search-result")
      .forEach((button) => {

        button.onclick = () => {

          destination = {
            lat: Number(button.dataset.lat),
            lng: Number(button.dataset.lon)
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

  } catch {

    box.innerHTML =
      "<div class='status'>تعذر البحث.</div>";
  }
}


/* =========================================================
   MAP EVENTS
   ========================================================= */

$("#myLocation").onclick =
  async () => {

    await setPickup();
  };


$("#mapLocation").onclick =
  setPickup;


$("#chooseDest").onclick =
  () => {

    screen("mapScreen");

    setTimeout(() => {

      initMap();

      map.invalidateSize();

    }, 150);
  };


$("#closeMap").onclick =
  () => screen("home");


$("#confirmDest").onclick =
  async () => {

    if (!destination) {

      msg(
        "حدد مكان الوصول أولاً",
        "error"
      );

      return;
    }


    const address =
      await reverse(
        destination.lat,
        destination.lng
      );


    $("#destText").innerHTML =
      `🏁 <strong>${esc(address)}</strong>`;


    screen("home");


    msg(
      "تم تحديد مكان الوصول بدقة ✅",
      "success"
    );
  };


let searchTimer;

$("#search").oninput =
  () => {

    clearTimeout(searchTimer);

    searchTimer =
      setTimeout(
        () =>
          searchPlaces(
            $("#search").value.trim()
          ),
        650
      );
  };


$("#rideDate").onchange =
  () => {

    $("#dayPreview").textContent =
      dayName($("#rideDate").value)
        ? `📆 ${dayName($("#rideDate").value)}`
        : "";
  };


/* =========================================================
   REQUEST RIDE
   ========================================================= */

$("#request").onclick =
  async () => {

    if (!user) {

      screen("login");

      return;
    }


    if (profile?.role !== "customer") {

      msg(
        "حساب الكابتن لا يطلب رحلة.",
        "error"
      );

      return;
    }


    if (!pickup || !destination) {

      msg(
        "حدد الانطلاق والوصول أولاً.",
        "error"
      );

      return;
    }


    const price =
      Number($("#price").value);

    const date =
      $("#rideDate").value;

    const time =
      $("#rideTime").value;


    if (!price || !date || !time) {

      msg(
        "اكتب السعر والتاريخ والوقت.",
        "error"
      );

      return;
    }


    try {

      const fromPlace =
        await reverse(
          pickup.lat,
          pickup.lng
        );


      const toPlace =
        await reverse(
          destination.lat,
          destination.lng
        );


      const ride =
        await addDoc(
          collection(db, "rides"),
          {
            customerId: user.uid,

            customerName:
              profile.name || "",

            customerPhoto:
              profile.photoURL || "",

            fromPlace,

            toPlace,

            pickupCoords:
              pickup,

            destinationCoords:
              destination,

            price,

            passengers:
              Number($("#passengers").value),

            notes:
              $("#notes").value.trim(),

            rideDate: date,

            rideTime: time,

            dayName:
              dayName(date),

            status: "open",

            captainId: "",

            createdAt:
              serverTimestamp()
          }
        );


      localStorage.setItem(
        "lastRide",
        ride.id
      );


      $("#price").value = "";
      $("#notes").value = "";


      msg(
        "تم نشر الرحلة للكباتن 🚕",
        "success"
      );


      screen("rides");

      loadCustomerRides();

    } catch (error) {

      console.error(error);

      msg(
        "تعذر إرسال الرحلة.",
        "error"
      );
    }
  };


/* =========================================================
   ROLE CHANGE
   ========================================================= */

$("#role").onchange =
  () => {

    $("#captainFields").style.display =
      $("#role").value === "captain"
        ? "block"
        : "none";
  };


$("#registerOpen").onclick =
  () => screen("register");


$("#backLogin").onclick =
  () => screen("login");


/* =========================================================
   AVATAR
   ========================================================= */

function avatarHTML(
  photo,
  name,
  cls = "profile-avatar"
) {

  const n =
    String(name || "مستخدم").trim();

  const initial =
    esc(
      n
        ? Array.from(n)[0]
        : "👤"
    );


  return photo

    ? `
      <img
        class="${cls}"
        src="${esc(photo)}"
        alt="${esc(n)}"
        loading="lazy"
        onerror="
          this.style.display='none';
          this.nextElementSibling.style.display='flex'
        "
      >

      <span
        class="${cls} avatar-fallback"
        style="display:none"
      >
        ${initial}
      </span>
    `

    : `
      <span
        class="${cls} avatar-fallback"
      >
        ${initial}
      </span>
    `;
}


/* =========================================================
   IMAGE RESIZE
   ========================================================= */

function resizeImage(
  file,
  max = 512,
  quality = 0.78
) {

  return new Promise(
    (resolve, reject) => {

      if (!file) {

        resolve(null);

        return;
      }


      if (!file.type.startsWith("image/")) {

        reject(
          Error("اختر صورة فقط.")
        );

        return;
      }


      const image = new Image();

      const url =
        URL.createObjectURL(file);


      image.onload = () => {

        try {

          const scale =
            Math.min(
              1,
              max /
                Math.max(
                  image.width,
                  image.height
                )
            );


          const canvas =
            document.createElement(
              "canvas"
            );


          canvas.width =
            Math.max(
              1,
              Math.round(
                image.width * scale
              )
            );


          canvas.height =
            Math.max(
              1,
              Math.round(
                image.height * scale
              )
            );


          const ctx =
            canvas.getContext("2d");


          ctx.drawImage(
            image,
            0,
            0,
            canvas.width,
            canvas.height
          );


          canvas.toBlob(
            (blob) => {

              URL.revokeObjectURL(url);

              blob
                ? resolve(blob)
                : reject(
                    Error(
                      "تعذر تجهيز الصورة."
                    )
                  );
            },
            "image/jpeg",
            quality
          );

        } catch (error) {

          URL.revokeObjectURL(url);

          reject(error);
        }
      };


      image.onerror = () => {

        URL.revokeObjectURL(url);

        reject(
          Error("الصورة غير صالحة.")
        );
      };


      image.src = url;
    }
  );
}


/* =========================================================
   UPLOAD PROFILE PHOTO
   ========================================================= */

async function uploadProfilePhoto(
  uid,
  file
) {

  if (!file) return "";

  const blob =
    await resizeImage(
      file,
      512,
      0.78
    );


  const storageRef =
    ref(
      storage,
      `profiles/${uid}/profile.jpg`
    );


  await uploadBytes(
    storageRef,
    blob,
    {
      contentType: "image/jpeg",
      cacheControl:
        "public,max-age=3600"
    }
  );


  return await getDownloadURL(
    storageRef
  );
}


/* =========================================================
   REGISTER
   ========================================================= */

$("#finishReg").onclick =
  async () => {

    const button =
      $("#finishReg");


    const name =
      $("#name").value.trim();


    const phoneNumber =
      phone(
        $("#regPhone").value
      );


    const password =
      $("#regPass").value;


    const password2 =
      $("#regPass2").value;


    const role =
      $("#role").value;


    $("#regMsg").textContent = "";


    /* ---------- VALIDATION ---------- */

    if (!name) {

      $("#regMsg").textContent =
        "اكتب الاسم بالكامل.";

      return;
    }


    if (
      !/^\+20\d{10}$/.test(
        phoneNumber
      )
    ) {

      $("#regMsg").textContent =
        "اكتب رقم موبايل مصري صحيح مثل 010xxxxxxxx.";

      return;
    }


    if (password.length < 6) {

      $("#regMsg").textContent =
        "كلمة المرور لازم تكون 6 أحرف أو أرقام على الأقل.";

      return;
    }


    if (password !== password2) {

      $("#regMsg").textContent =
        "كلمتا المرور غير متطابقتين.";

      return;
    }


    /*
      مهم:
      بيانات الكابتن يتم فحصها قبل إنشاء
      حساب Firebase حتى لا يظهر الحساب
      كأنه موجود لو البيانات ناقصة.
    */

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

      authBusy = true;

      button.disabled = true;

      button.textContent =
        "جاري إنشاء الحساب...";


      /*
        الحساب أصبح منفصل حسب النوع:

        customer:
        2010xxxxxxxx.customer@login...

        captain:
        2010xxxxxxxx.captain@login...
      */

      const internalEmail =
        loginEmail(
          phoneNumber,
          role
        );


      console.log(
        "REGISTER INTERNAL EMAIL:",
        internalEmail
      );


      const credential =
        await createUserWithEmailAndPassword(
          auth,
          internalEmail,
          password
        );


      const newUser =
        credential.user;


      const data = {

        uid: newUser.uid,

        name,

        phone: phoneNumber,

        role,

        photoURL: "",

        accountNumber:
          accountNo(),

        createdAt:
          serverTimestamp(),

        rating: 0,

        ratingCount: 0
      };


      if (role === "captain") {

        data.age =
          Number($("#age").value);

        data.carType =
          $("#carType")
            .value
            .trim();

        data.carModel =
          $("#carModel")
            .value
            .trim();

        data.plateNumber =
          $("#plate")
            .value
            .trim();

        data.captainStatus =
          "available";
      }


      try {

        await setDoc(
          doc(
            db,
            "users",
            newUser.uid
          ),
          data,
          {
            merge: true
          }
        );

      } catch (firestoreError) {

        /*
          لو Firebase Auth اتعمل بنجاح
          لكن Firestore فشل، نحاول نحذف
          حساب Auth حتى لا يفضل الحساب
          موجود ويظهر email-already-in-use.
        */

        console.error(
          "FIRESTORE PROFILE ERROR:",
          firestoreError
        );


        try {

          await deleteUser(
            newUser
          );

        } catch (deleteError) {

          console.error(
            "DELETE ORPHAN USER ERROR:",
            deleteError
          );
        }


        throw firestoreError;
      }


      /* ---------- PROFILE PHOTO ---------- */

      const photoFile =
        $("#profilePhoto")
          ?.files?.[0];


      if (photoFile) {

        try {

          data.photoURL =
            await uploadProfilePhoto(
              newUser.uid,
              photoFile
            );


          await updateDoc(
            doc(
              db,
              "users",
              newUser.uid
            ),
            {
              photoURL:
                data.photoURL
            }
          );

        } catch (photoError) {

          console.error(
            photoError
          );

          msg(
            "تم إنشاء الحساب، لكن تعذر رفع الصورة. يمكنك المحاولة لاحقاً.",
            "error"
          );
        }
      }


      user = newUser;

      profile = data;


      $("#regMsg").textContent =
        "تم إنشاء الحساب بنجاح ✅";


      msg(
        "تم إنشاء الحساب وتسجيل الدخول ✅",
        "success"
      );


      if (role === "captain") {

        screen("captain");

        loadCaptain();

      } else {

        screen("home");
      }


    } catch (error) {

      console.error(
        "REGISTER ERROR:",
        error
      );


      if (
        error.code ===
        "auth/email-already-in-use"
      ) {

        $("#regMsg").textContent =
          "الرقم ده مسجل بالفعل بهذا النوع من الحساب. استخدم تسجيل الدخول.";

      } else if (
        error.code ===
        "auth/invalid-email"
      ) {

        $("#regMsg").textContent =
          "بيانات رقم الموبايل غير صحيحة.";

      } else if (
        error.code ===
        "auth/weak-password"
      ) {

        $("#regMsg").textContent =
          "كلمة المرور ضعيفة. استخدم 6 أحرف أو أرقام على الأقل.";

      } else {

        $("#regMsg").textContent =
          error.message ||
          "تعذر إنشاء الحساب.";
      }

    } finally {

      authBusy = false;

      button.disabled = false;

      button.textContent =
        "إنشاء الحساب";
    }
  };


/* =========================================================
   LOGIN
   ========================================================= */

$("#loginBtn").onclick =
  async () => {

    const phoneNumber =
      phone(
        $("#loginPhone").value
      );


    const password =
      $("#loginPass").value;


    const role =
      $("#loginRole").value;


    $("#loginMsg").textContent = "";


    if (
      !/^\+20\d{10}$/.test(
        phoneNumber
      ) ||
      !password
    ) {

      $("#loginMsg").textContent =
        "اكتب رقم موبايل مصري صحيح وكلمة المرور.";

      return;
    }


    try {

      authBusy = true;


      const internalEmail =
        loginEmail(
          phoneNumber,
          role
        );


      console.log(
        "LOGIN INTERNAL EMAIL:",
        internalEmail
      );


      /*
        تسجيل الدخول بالحساب الخاص
        بالدور المختار.
      */

      const credential =
        await signInWithEmailAndPassword(
          auth,
          internalEmail,
          password
        );


      const loggedUser =
        credential.user;


      /*
        قراءة ملف المستخدم من Firestore
      */

      const profileDoc =
        await getDoc(
          doc(
            db,
            "users",
            loggedUser.uid
          )
        );


      if (!profileDoc.exists()) {

        await signOut(auth);

        $("#loginMsg").textContent =
          "حساب Firebase موجود، لكن بيانات الحساب غير موجودة في Firestore.";

        return;
      }


      const userProfile =
        profileDoc.data();


      /*
        تأكيد أن نوع الحساب هو نفس
        النوع الذي اختاره المستخدم.
      */

      if (
        userProfile.role !== role
      ) {

        await signOut(auth);

        $("#loginMsg").textContent =
          "الحساب ده مسجل بنوع حساب مختلف. اختار نوع الحساب الصحيح.";

        return;
      }


      user =
        loggedUser;

      profile =
        userProfile;


      $("#loginMsg").textContent =
        "تم تسجيل الدخول بنجاح ✅";


      if (role === "captain") {

        screen("captain");

        loadCaptain();

      } else {

        screen("home");

        loadCustomerRides();
      }


    } catch (error) {

      console.error(
        "LOGIN ERROR:",
        error
      );


      /*
        محاولة دعم الحسابات القديمة
        التي كانت تستخدم:
        2010xxxxxxxx@phone.wasselni.app

        لا يتم استخدامها إلا كحل احتياطي.
      */

      if (
        error.code === "auth/invalid-credential" ||
        error.code === "auth/wrong-password" ||
        error.code === "auth/user-not-found"
      ) {

        const legacyEmail =
          legacyLoginEmail(
            phoneNumber
          );


        if (
          legacyEmail &&
          role === "customer" &&
          legacyEmail !==
            loginEmail(
              phoneNumber,
              role
            )
        ) {

          try {

            authBusy = true;

            await signInWithEmailAndPassword(
              auth,
              legacyEmail,
              password
            );


            return;

          } catch (legacyError) {

            console.error(
              "LEGACY LOGIN ERROR:",
              legacyError
            );
          }
        }
      }


      if (
        error.code ===
        "auth/too-many-requests"
      ) {

        $("#loginMsg").textContent =
          "محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.";

      } else if (
        error.code ===
        "auth/user-disabled"
      ) {

        $("#loginMsg").textContent =
          "الحساب متوقف من Firebase Authentication.";

      } else if (
        error.code ===
        "auth/invalid-credential"
      ) {

        $("#loginMsg").textContent =
          "رقم الموبايل أو كلمة المرور غير صحيحة.";

      } else if (
        error.code ===
        "auth/user-not-found"
      ) {

        $("#loginMsg").textContent =
          "الحساب غير موجود بهذا النوع. تأكد أنك اخترت عميل أو كابتن بشكل صحيح.";

      } else {

        $("#loginMsg").textContent =
          "رقم الموبايل أو كلمة المرور غير صحيحة، أو الحساب غير موجود.";
      }

    } finally {

      authBusy = false;
    }
  };


/* =========================================================
   LOAD PROFILE
   ========================================================= */

async function loadProfile() {

  if (!user) return;


  const snapshot =
    await getDoc(
      doc(
        db,
        "users",
        user.uid
      )
    );


  if (snapshot.exists()) {

    profile =
      snapshot.data();
  }


  if (!profile) return;


  $("#profileInfo").innerHTML = `

    <div class="profile-main">

      ${avatarHTML(
        profile.photoURL,
        profile.name,
        "profile-avatar-lg"
      )}

      <div>

        <strong class="profile-name">
          ${esc(
            profile.name ||
              "بدون اسم"
          )}
        </strong>

        <div class="muted">
          ${
            profile.role === "captain"
              ? "🚗 كابتن"
              : "👤 عميل"
          }
        </div>

      </div>

    </div>


    <div class="profile-row">

      <span>
        👤 الاسم
      </span>

      <strong>
        ${esc(profile.name)}
      </strong>

    </div>


    <div class="profile-row">

      <span>
        📱 الموبايل
      </span>

      <strong>
        ${esc(profile.phone)}
      </strong>

    </div>


    <div class="profile-row">

      <span>
        🔢 رقم الحساب
      </span>

      <strong>
        ${esc(profile.accountNumber)}
      </strong>

    </div>


    <div class="profile-row">

      <span>
        النوع
      </span>

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

            <span>
              🚘 العربية
            </span>

            <strong>
              ${esc(
                profile.carType
              )}

              ${esc(
                profile.carModel
              )}

              -

              ${esc(
                profile.plateNumber
              )}
            </strong>

          </div>


          <div class="profile-row">

            <span>
              ⭐ التقييم
            </span>

            <strong>
              ${Number(
                profile.rating || 0
              ).toFixed(1)}

              (${profile.ratingCount || 0})
            </strong>

          </div>

        `
        : ""
    }

  `;
}


/* =========================================================
   CUSTOMER RIDE CARD
   ========================================================= */

function customerCard(ride) {

  let contact = "";


  if (
    ride.status === "accepted" ||
    ride.status === "captain_to_customer" ||
    ride.status === "arrived" ||
    ride.status === "started" ||
    ride.status === "completed"
  ) {

    contact =
      ride.captainPhone
        ? `

          <div class="contact-box captain-mini">

            <div class="person-line">

              ${avatarHTML(
                ride.captainPhoto,
                ride.captainName,
                "profile-avatar"
              )}

              <div>

                <strong>
                  ${esc(
                    ride.captainName ||
                      "الكابتن"
                  )}
                </strong>

                <small>
                  🚗

                  ${esc(
                    ride.captainCarType ||
                      ""
                  )}

                  ${esc(
                    ride.captainCarModel ||
                      ""
                  )}

                </small>

              </div>

            </div>

            📞

            <a
              href="tel:${esc(
                ride.captainPhone
              )}"
            >
              ${esc(
                ride.captainPhone
              )}
            </a>

          </div>

        `
        : "";
  }


  return `

    <div class="card">

      <div class="ride-status">
        ${statusText(ride.status)}
      </div>


      <div class="person-line customer-trip-person">

        ${avatarHTML(
          ride.customerPhoto ||
            profile?.photoURL,
          ride.customerName ||
            profile?.name,
          "profile-avatar"
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
            صاحب الرحلة
          </small>

        </div>

      </div>


      <b>
        📍
        ${esc(ride.fromPlace)}
      </b>

      <br>

      🏁
      ${esc(ride.toPlace)}


      <p>
        💰
        ${ride.price}
        جنيه
        •
        👥
        ${ride.passengers}
      </p>


      <p>
        📅
        ${formatDate(
          ride.rideDate
        )}

        •

        ${esc(
          ride.dayName
        )}

        •

        🕐
        ${esc(
          ride.rideTime
        )}
      </p>


      ${
        ride.notes
          ? `
            <p>
              📝
              ${esc(
                ride.notes
              )}
            </p>
          `
          : ""
      }


      ${contact}


      ${
        ride.status === "started"
          ? `
            <button
              class="btn green"
              data-complete-customer="${ride.id}"
            >
              ✅ انتهت الرحلة
            </button>
          `
          : ""
      }

    </div>

  `;
}


/* =========================================================
   CUSTOMER RIDES
   ========================================================= */

async function loadCustomerRides() {

  if (
    !user ||
    profile?.role !== "customer"
  ) {
    return;
  }


  if (watchCustomer) {
    watchCustomer();
  }


  watchCustomer =
    onSnapshot(
      query(
        collection(
          db,
          "rides"
        ),

        where(
          "customerId",
          "==",
          user.uid
        ),

        limit(50)
      ),

      (snapshot) => {

        const rides =
          snapshot.docs
            .map(
              (item) => ({
                id: item.id,
                ...item.data()
              })
            )
            .sort(
              (a, b) =>
                (
                  b.createdAt?.seconds ||
                  0
                ) -
                (
                  a.createdAt?.seconds ||
                  0
                )
            );


        $("#ridesList").innerHTML =
          rides.length

            ? rides
                .map(customerCard)
                .join("")

            : `
              <div class="card">
                لا توجد رحلات حتى الآن.
              </div>
            `;


        document
          .querySelectorAll(
            "[data-complete-customer]"
          )
          .forEach((button) => {

            button.onclick =
              () =>
                updateDoc(
                  doc(
                    db,
                    "rides",
                    button.dataset
                      .completeCustomer
                  ),
                  {
                    status:
                      "completed",

                    completedAt:
                      serverTimestamp()
                  }
                );
          });
      }
    );
}


/* =========================================================
   CAPTAIN
   ========================================================= */

async function loadCaptain() {

  if (
    profile?.role !== "captain"
  ) {

    $("#captainList").innerHTML =
      `
        <div class="card">
          هذه الصفحة للكابتن فقط.
        </div>
      `;

    return;
  }


  $("#captainState").textContent =
    profile.captainStatus ===
    "available"

      ? "🟢 أنت متاح لاستقبال الرحلات"

      : "⚫ أنت غير متاح";


  if (watchRides) {
    watchRides();
  }


  watchRides =
    onSnapshot(
      query(
        collection(
          db,
          "rides"
        ),

        where(
          "status",
          "==",
          "open"
        ),

        limit(50)
      ),

      (snapshot) => {

        $("#captainList").innerHTML =

          profile.captainStatus ===
            "available" &&
          snapshot.docs.length

            ? snapshot.docs
                .map(
                  (item) => {

                    const ride =
                      item.data();


                    return `

                      <div class="card">

                        <div class="ride-status">
                          🆕 رحلة جديدة
                        </div>


                        <div class="person-line customer-trip-person">

                          ${avatarHTML(
                            ride.customerPhoto,
                            ride.customerName ||
                              "العميل",
                            "profile-avatar"
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


                        <b>
                          📍
                          ${esc(
                            ride.fromPlace
                          )}
                        </b>

                        <br>

                        🏁
                        ${esc(
                          ride.toPlace
                        )}


                        <p>
                          💰
                          ${ride.price}
                          جنيه
                          •
                          👥
                          ${ride.passengers}
                        </p>


                        <p>
                          📅
                          ${formatDate(
                            ride.rideDate
                          )}

                          •

                          ${esc(
                            ride.dayName
                          )}

                          •

                          🕐
                          ${esc(
                            ride.rideTime
                          )}
                        </p>


                        ${
                          ride.notes
                            ? `
                              <p>
                                📝
                                ${esc(
                                  ride.notes
                                )}
                              </p>
                            `
                            : ""
                        }


                        <button
                          class="btn green"
                          data-accept="${item.id}"
                        >
                          ✅ قبول الرحلة
                        </button>

                      </div>

                    `;
                  }
                )
                .join("")

            : `
              <div class="card">
                لا توجد رحلات متاحة الآن.
              </div>
            `;


        document
          .querySelectorAll(
            "[data-accept]"
          )
          .forEach((button) => {

            button.onclick =
              () =>
                acceptRide(
                  button.dataset.accept
                );
          });
      }
    );


  if (watchCaptainAccepted) {
    watchCaptainAccepted();
  }


  watchCaptainAccepted =
    onSnapshot(
      query(
        collection(
          db,
          "rides"
        ),

        where(
          "captainId",
          "==",
          user.uid
        ),

        limit(30)
      ),

      (snapshot) => {

        $("#captainAcceptedList").innerHTML =

          snapshot.docs.length

            ? snapshot.docs
                .map(
                  (item) => {

                    const ride =
                      item.data();


                    return `

                      <div class="card">

                        <div class="ride-status">
                          ${statusText(
                            ride.status
                          )}
                        </div>


                        <div class="person-line customer-trip-person">

                          ${avatarHTML(
                            ride.customerPhoto,
                            ride.customerName ||
                              "العميل",
                            "profile-avatar"
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


                        <b>
                          📍
                          ${esc(
                            ride.fromPlace
                          )}
                        </b>

                        <br>

                        🏁
                        ${esc(
                          ride.toPlace
                        )}


                        <p>
                          💰
                          ${ride.price}
                          جنيه
                          •
                          👥
                          ${ride.passengers}
                        </p>


                        <p>
                          📅
                          ${formatDate(
                            ride.rideDate
                          )}

                          •

                          ${esc(
                            ride.dayName
                          )}

                          •

                          🕐
                          ${esc(
                            ride.rideTime
                          )}
                        </p>


                        ${
                          ride.notes
                            ? `
                              <p>
                                📝
                                ${esc(
                                  ride.notes
                                )}
                              </p>
                            `
                            : ""
                        }


                        ${
                          ride.customerPhone
                            ? `
                              <div class="contact-box">

                                📞

                                <a
                                  href="tel:${esc(
                                    ride.customerPhone
                                  )}"
                                >
                                  ${esc(
                                    ride.customerPhone
                                  )}
                                </a>

                                —

                                ${esc(
                                  ride.customerName ||
                                    "العميل"
                                )}

                              </div>
                            `
                            : ""
                        }


                        ${
                          ride.status ===
                          "accepted"

                            ? `
                              <button
                                class="btn primary"
                                data-customer-route="${item.id}"
                              >
                                🚗 أنا في الطريق للعميل
                              </button>
                            `

                            : ""
                        }


                        ${
                          ride.status ===
                          "captain_to_customer"

                            ? `
                              <button
                                class="btn green"
                                data-arrived="${item.id}"
                              >
                                📍 وصلت للعميل
                              </button>
                            `

                            : ""
                        }


                        ${
                          ride.status ===
                          "arrived"

                            ? `
                              <button
                                class="btn primary"
                                data-start="${item.id}"
                              >
                                ▶️ بدء الرحلة
                              </button>
                            `

                            : ""
                        }


                        ${
                          ride.status ===
                          "started"

                            ? `
                              <button
                                class="btn green"
                                data-complete="${item.id}"
                              >
                                🏁 إنهاء الرحلة
                              </button>
                            `

                            : ""
                        }

                      </div>

                    `;
                  }
                )
                .join("")

            : `
              <div class="card">
                لا توجد رحلات قبلتها.
              </div>
            `;


        bindCaptainActions();
      }
    );
}


/* =========================================================
   CAPTAIN ACTIONS
   ========================================================= */

function bindCaptainActions() {

  document
    .querySelectorAll(
      "[data-customer-route]"
    )
    .forEach((button) => {

      button.onclick =
        () =>
          updateDoc(
            doc(
              db,
              "rides",
              button.dataset
                .customerRoute
            ),
            {
              status:
                "captain_to_customer",

              updatedAt:
                serverTimestamp()
            }
          );
    });


  document
    .querySelectorAll(
      "[data-arrived]"
    )
    .forEach((button) => {

      button.onclick =
        () =>
          updateDoc(
            doc(
              db,
              "rides",
              button.dataset.arrived
            ),
            {
              status:
                "arrived",

              updatedAt:
                serverTimestamp()
            }
          );
    });


  document
    .querySelectorAll(
      "[data-start]"
    )
    .forEach((button) => {

      button.onclick =
        () =>
          updateDoc(
            doc(
              db,
              "rides",
              button.dataset.start
            ),
            {
              status:
                "started",

              startedAt:
                serverTimestamp()
            }
          );
    });


  document
    .querySelectorAll(
      "[data-complete]"
    )
    .forEach((button) => {

      button.onclick =
        () =>
          updateDoc(
            doc(
              db,
              "rides",
              button.dataset.complete
            ),
            {
              status:
                "completed",

              completedAt:
                serverTimestamp()
            }
          );
    });
}


/* =========================================================
   ACCEPT RIDE
   ========================================================= */

async function acceptRide(id) {

  if (
    !user ||
    profile?.role !== "captain"
  ) {
    return;
  }


  try {

    await runTransaction(
      db,
      async (transaction) => {

        const rideRef =
          doc(
            db,
            "rides",
            id
          );


        const snapshot =
          await transaction.get(
            rideRef
          );


        if (
          !snapshot.exists() ||
          snapshot.data().status !==
            "open"
        ) {

          throw Error(
            "الرحلة اتقبلت بالفعل"
          );
        }


        transaction.update(
          rideRef,
          {

            status:
              "accepted",

            captainId:
              user.uid,

            captainName:
              profile.name || "",

            captainPhoto:
              profile.photoURL || "",

            captainPhone:
              profile.phone ||
              user.phoneNumber ||
              "",

            captainCarType:
              profile.carType ||
              "",

            captainCarModel:
              profile.carModel ||
              "",

            captainPlateNumber:
              profile.plateNumber ||
              "",

            acceptedAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp()
          }
        );
      }
    );


    msg(
      "تم قبول الرحلة. رقم العميل ظهر لك 📞",
      "success"
    );


    loadCaptain();

  } catch (error) {

    console.error(error);

    msg(
      error.message ||
        "تعذر قبول الرحلة",
      "error"
    );
  }
}


/* =========================================================
   CAPTAIN AVAILABILITY
   ========================================================= */

$("#captainAvailable").onclick =
  async () => {

    if (
      profile?.role !== "captain"
    ) {
      return;
    }


    await updateDoc(
      doc(
        db,
        "users",
        user.uid
      ),
      {
        captainStatus:
          "available"
      }
    );


    profile.captainStatus =
      "available";


    loadCaptain();
  };


$("#captainUnavailable").onclick =
  async () => {

    if (
      profile?.role !== "captain"
    ) {
      return;
    }


    await updateDoc(
      doc(
        db,
        "users",
        user.uid
      ),
      {
        captainStatus:
          "unavailable"
      }
    );


    profile.captainStatus =
      "unavailable";


    loadCaptain();
  };


/* =========================================================
   NAVIGATION
   ========================================================= */

$("#navHome").onclick =
  () => {

    if (
      profile?.role === "captain"
    ) {

      screen("captain");

    } else {

      screen("home");
    }
  };


$("#navRides").onclick =
  () => {

    if (
      profile?.role !== "customer"
    ) {

      msg(
        "رحلاتي هنا للعميل.",
        "error"
      );

      return;
    }


    screen("rides");

    loadCustomerRides();
  };


$("#navCaptain").onclick =
  () => {

    if (
      profile?.role !== "captain"
    ) {

      msg(
        "صفحة الكابتن للحسابات المسجلة ككابتن فقط.",
        "error"
      );

      return;
    }


    screen("captain");

    loadCaptain();
  };


$("#navProfile").onclick =
  async () => {

    await loadProfile();

    screen("profile");
  };


$("#profileTop").onclick =
  async () => {

    await loadProfile();

    screen("profile");
  };


/* =========================================================
   LOGOUT
   ========================================================= */

$("#logout").onclick =
  async () => {

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
  };


/* =========================================================
   AUTH STATE
   ========================================================= */

onAuthStateChanged(
  auth,
  async (firebaseUser) => {

    /*
      أثناء إنشاء الحساب لا نخلي
      onAuthStateChanged يعمل redirect
      قبل ما Firestore يخلص.
    */

    if (authBusy) {
      return;
    }


    user = firebaseUser;


    if (!firebaseUser) {

      profile = null;

      screen("login");

      return;
    }


    try {

      await loadProfile();


      if (
        profile?.role === "captain"
      ) {

        screen("captain");

        loadCaptain();

      } else if (
        profile?.role === "customer"
      ) {

        screen("home");

        loadCustomerRides();

      } else {

        await signOut(auth);

        user = null;

        profile = null;

        screen("login");
      }

    } catch (error) {

      console.error(
        "AUTH STATE ERROR:",
        error
      );

      await signOut(auth);

      user = null;

      profile = null;

      screen("login");
    }
  }
);


/* =========================================================
   INITIAL SCREEN
   ========================================================= */

screen("login");ط
