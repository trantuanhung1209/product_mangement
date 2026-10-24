# Phase 06 — Product CRUD Frontend

## 1. Controlled form là gì?

`ProductForm` giữ mỗi giá trị input trong React state (`values`). Ví dụ ô tên
đọc `values.name` và đổi qua `updateValue("name", event.target.value)`. Vì
vậy React luôn biết chính xác dữ liệu sẽ gửi, có thể hiển thị lỗi ngay dưới
đúng field, và disable nút lưu trong lúc submit. Đây khác uncontrolled form,
nơi DOM tự giữ giá trị và chỉ đọc khi submit.

## 2. Client validation và server validation khác nhau thế nào?

`validate()` trong `ProductForm.tsx` kiểm tra tên rỗng, giá, tồn kho, danh mục
và URL trước khi gửi request. Nó giúp phản hồi nhanh và hiện tiếng Việt. Nhưng
backend FastAPI/Pydantic vẫn là nguồn kiểm tra cuối: category có thể vừa bị
xóa, hoặc request có thể bị sửa từ DevTools. Khi API trả 422, form đổi lỗi đó
thành lỗi theo field; các lỗi khác hiện thông báo chung để không lộ chi tiết
hệ thống.

## 3. PUT khác PATCH ở đâu?

Khi sửa, `updateProduct()` gọi `PUT /api/v1/products/{id}` và gửi đủ sáu field
trong `ProductPayload`, đúng với `ProductUpdate` của backend. `PATCH` chỉ nên
gửi các field thực sự đổi; nó hữu ích cho UI chỉnh một trường đơn lẻ. Form này
luôn có đủ dữ liệu từ `GET /products/{id}`, nên PUT đơn giản và không vô tình
giữ state cũ không nhìn thấy.

## 4. Form submission lifecycle

Người dùng submit → client validate → tạo `AbortController` → disable nút
Lưu và gọi Axios → API trả kết quả → toast thành công và điều hướng đến detail.
Nếu component unmount, cleanup abort request còn dang dở. Nếu lỗi, nút được
bật lại và dữ liệu người dùng đã nhập vẫn giữ nguyên để sửa tiếp.

## 5. Error handling được đặt ở đâu?

`api/errors.ts` nhận diện response Axios: `detail` là chuỗi (ví dụ 404/409)
hoặc mảng validation của FastAPI. `ProductForm` dùng kết quả để đặt lỗi dưới
field; detail không gắn field hiển thị ở đầu form. Delete lỗi thì giữ sản phẩm
trên màn hình và hiện toast đỏ, thay vì điều hướng nhầm sang danh sách.

## 6. Debug mutation trong Browser Network

Mở DevTools → **Network**, thực hiện thêm/sửa/xóa, rồi chọn request
`POST`, `PUT` hoặc `DELETE` tương ứng. Kiểm tra Request Payload có `price`
dạng chuỗi Decimal và `category_id` là số; response cần là 201, 200 hoặc 204.
Với lỗi validation, xem response 422 và đối chiếu field `loc` với tên field
trong `ProductForm`. Request bị hủy khi rời trang sẽ hiện `canceled`; đó là
cleanup chủ động, không phải lỗi API.
