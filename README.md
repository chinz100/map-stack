# Map Stack Monorepo

โครงงานนี้เตรียมสภาพแวดล้อมเพื่อทดสอบงาน “Thailand Ops Map” ด้วย Turborepo (pnpm) โดยแบ่งเป็น

- `apps/backend` – Express + TypeScript mock API
- `apps/web` – Next.js frontend สำหรับโจทย์

## ขั้นตอนเริ่มต้น

1. Clone โปรเจ็กต์  
   ```sh
   git clone <repo-url> map-stack
   cd map-stack
   ```
   (ถ้าต้องการล็อกเวอร์ชัน Node ตามที่ repo กำหนด)  
   ```sh
   nvm use
   ```
2. เตรียม environment  
   ```sh
   cp .env.simple .env
   ```
   ไฟล์ `.env` กำหนด `PORT=4000` (backend) และ `WEB_PORT=3000` (frontend) ปรับได้ตามต้องการ
3. ติดตั้ง dependency  
   ```sh
   pnpm install
   ```
4. รันทั้ง backend + web พร้อมกัน  
   ```sh
   pnpm dev
   ```
   - Backend: http://localhost:${PORT:-4000}  
   - Web: http://localhost:${WEB_PORT:-3000}

## คำสั่งหลัก

- `pnpm dev:backend` – รันเฉพาะ mock API (Express)
- `pnpm dev:web` – รันเฉพาะ Next.js frontend
- `pnpm lint` – ตรวจ lint ทั้งสองแอป
- `pnpm build` – สร้าง production build
- `pnpm format` – จัดโค้ดด้วย Prettier

## โครงสร้างโฟลเดอร์

- `apps/backend` – endpoint เช่น `/provinces`, `/districts`, `/pois`, `/pois-tile`
- `apps/web` – UI React/Next.js สำหรับแผนที่
- `packages/*` – พื้นที่สำหรับ shared libraries (ถ้ามีในอนาคต)
- `turbo.json` – pipeline ที่กำหนดให้ run/build/lint เฉพาะ backend + web
- `pnpm-workspace.yaml` – ประกาศ workspace ทั้งหมด

## เครื่องมือที่ใช้

- Turborepo 2.x – จัดการ task/caching ใน monorepo
- pnpm 9 – จัดการ dependency/workspace
- TypeScript 5.9 – ใช้ type safety
- Prettier 3.6 – formatter มาตรฐานทีม

พร้อมสำหรับการพัฒนา/ทดสอบโจทย์ frontend และ mock backend ตามสเปคแล้วครับ.
