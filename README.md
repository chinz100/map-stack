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
- `pnpm map:gen` – สร้าง/รีเฟรช mock POIs (`apps/backend/src/data/thailand-cities.geojson`)
- `pnpm map:gen-point` – สร้างไฟล์สรุปเมือง/คลัสเตอร์ (`apps/backend/src/data/thailand-cities-point.geojson`)
  - ใช้ `pnpm map:gen-point [options]` แล้วเพิ่มพารามิเตอร์ เช่น `--clusters-per-city`, `--spread-km`, `--seed` เพื่อควบคุมจำนวนคลัสเตอร์และการกระจาย
  - ตัวอย่าง: `pnpm map:gen-point --clusters-per-city 12 --spread-km 45 --min-count 200 --max-count 1500 --seed 2026`
  - แนะนำให้รันหลังจาก `pnpm map:gen` ทุกครั้งเพื่ออัปเดตจุดสรุปให้ตรงกับ POIs ล่าสุด
- `pnpm map:gel-all` – รันทั้ง `map:gen` และ `map:gen-point` ต่อเนื่องกันในคำสั่งเดียว

## Mock API ที่มีให้

- `GET /api/geo/cities` – GeoJSON เมืองหลัก + seed สำหรับคลัสเตอร์
  - รองรับ `bbox=minLon,minLat,maxLon,maxLat`
  - ใช้ `?kind=city|cluster|all` เพื่อเลือกข้อมูลเฉพาะ type (ดีฟอลต์ `city`)
- `GET /api/geo/pois/clusters` – ข้อมูล aggregated สำหรับทำ cluster เมื่อ zoom กว้าง
  - รองรับ `bbox`, `zoom` (ดีฟอลต์ 8), `limit` (ดีฟอลต์ 500)

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

## โจทย์หลัก

### repo
```sh
   git clone https://github.com/chinz100/map-stack.git
```

1. พัฒนาแผนที่แบบคลัสเตอร์ที่ตอบโจทย์งาน
2. เชื่อมต่อและดึงข้อมูลจริงจาก `GET /api/geo/cities`
3. ออกแบบการแสดงผลแยกตามระดับซูม 2 ช่วงหลัก (มุมมองใกล้ และมุมมองไกล)
4. ประยุกต์ใช้เทคนิคการเรียก API ตามแนวทางใน README นี้
5. หากต่อยอดด้วยโจทย์เสริม Map WebGL จะได้รับการพิจารณาเพิ่มเติม

## โจทย์เสริม (Option): Map WebGL

สำหรับผู้สมัครที่โฟกัส Performance/Graphics  
เป้าหมายคือเรนเดอร์จุด 200k–500k ด้วยเฟรมเรตสูง (50–60fps) พร้อมการโต้ตอบที่ลื่นไหล แสดงรายละเอียด และกรองข้อมูลได้

### รายละเอียดงาน
1. สร้างเลเยอร์ WebGL ให้บรรลุเป้าหมายด้านประสิทธิภาพ
2. สรุปเทคนิคที่ใช้เพื่อลด GC/งานฝั่ง JavaScript เช่น typed arrays, memoization, binary attributes
3. นำเสนอแนวทางหรือเทคนิคเพิ่มเติมที่ช่วยให้ผลงานดีขึ้น

### ผลลัพธ์ที่คาดหวัง
- เดโมที่เปิด/ปิดเปรียบเทียบเลเยอร์ปกติกับเลเยอร์ WebGL custom
- รายงาน benchmark สั้นสำหรับอธิบายประสิทธิภาพ

### การส่งมอบ
- สร้าง git และอัปโหลดทั้ง repo ไปยังที่เก็บของผู้สมัครเอง

พร้อมสำหรับการพัฒนา/ทดสอบโจทย์ frontend และ mock backend ตามสเปคแล้วครับ.
