import React, { useRef, useState } from 'react';
import * as Select from '@radix-ui/react-select';
type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'multiple'>;
type SelectChildProps = { value?: string | number | readonly string[]; children?: React.ReactNode; disabled?: boolean };
export function GlassSelect({children,value,defaultValue,onChange,id,name,disabled,required,className,style,autoFocus,...rest}:Props) {
 const trigger=useRef<HTMLButtonElement>(null);
 const [open,setOpen]=useState(false);
 const options: {value:string;label:React.ReactNode;disabled?:boolean}[]=[];
 function collect(nodes:React.ReactNode){React.Children.forEach(nodes,node=>{if(!React.isValidElement<SelectChildProps>(node))return;if(node.type===React.Fragment)collect(node.props.children);else if(node.type==='option')options.push({value:String(node.props.value ?? node.props.children),label:node.props.children,disabled:node.props.disabled});});}
 collect(children);
 return <Select.Root value={value===undefined?undefined:String(value)} defaultValue={defaultValue===undefined?undefined:String(defaultValue)} open={open} onOpenChange={setOpen} name={name} disabled={disabled} required={required} onValueChange={next=>onChange?.({target:{value:next},currentTarget:{value:next}} as React.ChangeEvent<HTMLSelectElement>)}>
  <Select.Trigger ref={trigger} id={id} aria-label={rest['aria-label']} aria-labelledby={rest['aria-labelledby']} autoFocus={autoFocus} className={`glass-select-trigger ${className||''}`} style={style}><Select.Value/><Select.Icon><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></Select.Icon></Select.Trigger>
  <Select.Portal container={trigger.current?.closest('dialog') || undefined}><Select.Content position="popper" sideOffset={8} collisionPadding={12} className="glass-select-menu"><Select.ScrollUpButton className="glass-scroll">Scroll up</Select.ScrollUpButton><Select.Viewport>{options.map(option=><Select.Item key={option.value} value={option.value} disabled={option.disabled} className="glass-select-option"><Select.ItemIndicator className="glass-select-check"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></Select.ItemIndicator><Select.ItemText className="glass-select-text">{option.label}</Select.ItemText></Select.Item>)}</Select.Viewport><Select.ScrollDownButton className="glass-scroll">Scroll down</Select.ScrollDownButton></Select.Content></Select.Portal>
 </Select.Root>;
}
