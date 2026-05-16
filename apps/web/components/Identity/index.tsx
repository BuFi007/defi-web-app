import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { truncateAddress } from "@/utils";
import { Hex } from "viem";

export const BuIdentity = ({
  address,
  ensName,
}: {
  address: Hex;
  ensName?: string;
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bu Identity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 justify-center">
            <span>{ensName || truncateAddress(address)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
