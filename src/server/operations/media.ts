import "server-only";
import { database } from "../db";
import { HttpError } from "../errors";
import { staff, type Actor } from "./core";
export async function authorizedStaffMedia(actor: Actor, id: string) {
  staff(actor);
  if (actor.role === "admin") return;
  const m = await database().media.findFirst({
    where: {
      id,
      OR: [
        { productImages: { some: {} } },
        ...(actor.role === "warehouse"
          ? [
              {
                orderImages: {
                  some: {
                    order: {
                      paymentStatus: "PAID" as const,
                      fulfillmentStatus: { not: "CANCELLED" as const },
                    },
                  },
                },
              },
            ]
          : []),
        {
          receiptAttachments: {
            some: { receipt: { transfer: { destination: "MELBOURNE" } } },
          },
        },
      ],
    },
    select: { id: true },
  });
  if (!m) throw new HttpError(404, "Media not found.");
}

export async function authorizedOrderImage(orderId: string, mediaId: string) {
  if (
    !(await database().orderLine.count({
      where: { orderId, imageMediaId: mediaId },
    }))
  )
    throw new HttpError(404, "Image not found.");
}
