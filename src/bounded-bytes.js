const limit=()=>Object.assign(new Error('応答データが容量上限を超えています。'),{code:'RESPONSE_LIMIT'});
// Copy received bytes immediately instead of retaining one object per network
// fragment. Capacity grows geometrically and never exceeds the declared bound.
export class BoundedBytes {
  #buffer=null;#size=0;#closed=false;#maximum;
  constructor(maximum){
    if(!Number.isSafeInteger(maximum)||maximum<1||maximum>32*1024*1024)throw new Error('応答の容量設定が不正です。');
    this.#maximum=maximum;
  }
  get length(){return this.#size;}
  get capacity(){return this.#buffer?.length??0;}
  append(value){
    if(this.#closed)throw new Error('応答の収集は終了しています。');
    if(!(value instanceof Uint8Array))throw new Error('応答データの形式が不正です。');
    const needed=this.#size+value.byteLength;if(needed>this.#maximum)throw limit();if(!value.byteLength)return;
    if(needed>this.capacity){
      const capacity=Math.min(this.#maximum,Math.max(needed,this.capacity?this.capacity*2:16384)),next=Buffer.allocUnsafeSlow(capacity);
      this.#buffer?.copy(next,0,0,this.#size);this.#buffer=next;
    }
    this.#buffer.set(value,this.#size);this.#size=needed;
  }
  finish(){
    if(this.#closed)throw new Error('応答の収集は終了しています。');
    let output;
    if(this.#size===this.capacity)output=this.#buffer??Buffer.alloc(0);
    else{output=Buffer.allocUnsafeSlow(this.#size);this.#buffer.copy(output,0,0,this.#size);}
    this.dispose();return output;
  }
  dispose(){this.#buffer=null;this.#size=0;this.#closed=true;}
}
